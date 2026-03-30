const fs = require('fs');
const path = require('path');
const { createWithRetry } = require('../lib/anthropic-client');
const DATA_DIR = path.join(__dirname, '..', 'data');
const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');

function readJSON(filePath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function selectPattern(patterns, history) {
  const recent3 = history.slice(-3).map(h => h.pattern_id);
  const available = patterns.filter(p => !recent3.includes(p.id));
  return available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : patterns[Math.floor(Math.random() * patterns.length)];
}

function selectHook(hooks, history) {
  const recent5 = history.slice(-5).map(h => h.hook_id);
  const available = hooks.filter(h => !recent5.includes(h.id));
  return available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : hooks[Math.floor(Math.random() * hooks.length)];
}

function selectTheme(themes, history) {
  const recent3 = history.slice(-3).map(h => h.theme);
  if (recent3.length === 3 && recent3.every(t => t === recent3[0])) {
    const filtered = themes.filter(t => t !== recent3[0]);
    if (filtered.length > 0) return filtered[Math.floor(Math.random() * filtered.length)];
  }
  return themes[Math.floor(Math.random() * themes.length)];
}

// ツイートタイプを決定（投稿の多様性確保）
function selectTweetType(postIndex, history) {
  const recent5Types = history.slice(-5).map(h => h.tweet_type || 'standard');
  const shortCount = recent5Types.filter(t => t === 'short_personal').length;
  const ctaCount = recent5Types.filter(t => t === 'note_cta').length;

  // ロールベースで選択（バランス重視）
  const roll = Math.random();
  if (shortCount < 2 && roll < 0.25) return 'short_personal';   // 25%: 短め親近感
  if (ctaCount < 1 && roll < 0.40) return 'note_cta';           // 15%: Note誘導
  if (roll < 0.55) return 'contrarian';                          // 15%: 逆張り
  return 'standard';                                              // 45%: データ分析系
}

async function generatePost(persona, patterns, hooks, buzzRef, history, feedback, researchPool, postIndex) {
  const selectedPattern = selectPattern(patterns.patterns || [], history);
  const selectedHook = selectHook(hooks.hooks || [], history);
  const themes = persona.themes?.main_categories || [];
  const selectedTheme = selectTheme(themes, history);
  const tweetType = selectTweetType(postIndex, history);

  const unused = researchPool.filter(r => !r.used);
  const highUrgency = unused.filter(r => r.urgency === 'high');
  const researchItem = highUrgency.length > 0 ? highUrgency[0] : (unused.length > 0 ? unused[0] : null);

  // ペルソナのキーポイントのみ抽出（プロンプト圧縮）
  const personaSummary = {
    name: persona.name,
    description: persona.description,
    tone: persona.tone,
    virality_principles: persona.virality_principles,
    themes: themes
  };

  // 構造パターンは上位3件のみ
  const topPatterns = (buzzRef.structural_patterns || []).slice(0, 3);

  const tweetTypeInstructions = {
    standard: `【データ分析系】数字・データを軸にした深い分析。250文字前後。`,
    short_personal: `【短め親近感系】80〜120文字の短いツイート。「正直に言うと」「みんなに聞きたい」「これ知ってた？」などの口語。データは最小限。思わず反応したくなる親近感重視。`,
    contrarian: `【逆張り・議論誘発系】みんなが信じていることに疑問を投げかける。「〜って本当か？」「実はこれ、間違ってる」の構成。240文字前後。`,
    note_cta: `【Note誘導系】有益な情報を少しだけ見せて「詳しくはNoteに書きました（準備中）」で終わる。知的好奇心を刺激する。230文字前後。`
  };

  // 生成＋採点を1回のAPIコールで実行（コスト50%削減）
  const systemPrompt = `あなたはX投資アカウント「kaizokuokabu」の投稿AIです。

## ペルソナ要約
${JSON.stringify(personaSummary, null, 2)}

## パターン
${JSON.stringify(selectedPattern, null, 2)}

## フック
${JSON.stringify(selectedHook, null, 2)}

## バズ構造（参考）
${JSON.stringify(topPatterns, null, 2)}

${feedback ? `## アナリストフィードバック\n${JSON.stringify(feedback, null, 2)}` : ''}

## 絶対ルール
- 特定銘柄の「買い推奨」「売り推奨」はしない
- 免責文不要（プロフィールに記載済み）
- ハッシュタグ0〜2個
- 1行目でスクロールを止める`;

  const userPrompt = `テーマ「${selectedTheme}」でツイートを生成し、JSONで出力してください。

ツイートタイプ: ${tweetTypeInstructions[tweetType]}

${researchItem ? `最新ネタ（優先使用）:\nタイトル: ${researchItem.title}\n要約: ${researchItem.summary}\n投資角度: ${researchItem.investment_angle}` : ''}

出力形式（JSONのみ、余計なテキスト一切不要）:
{"text":"投稿テキスト","scores":{"buzz":0,"hook":0,"value":0,"data":0,"unique":0,"discussion":0,"bookmark":0,"tempo":0,"persona":0,"ng_check":0},"average":0.0}

採点基準: buzz=RT期待度, hook=1行目の引力, value=有益性, data=数字効果, unique=独自性, discussion=リプ誘発, bookmark=保存欲, tempo=読みやすさ, persona=キャラ一致, ng_check=投資助言非該当`;

  let bestPost = null;
  let bestScore = 0;

  for (let retry = 0; retry < 3; retry++) {
    const response = await createWithRetry({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt
    });

    const rawText = response.content[0].text.trim();
    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      continue;
    }

    const postText = parsed.text?.trim();
    if (!postText) continue;

    const scoreData = {
      scores: parsed.scores || {},
      average: parsed.average || Object.values(parsed.scores || {}).reduce((a, b) => a + b, 0) / 10
    };

    console.log(`  [writer] 投稿#${postIndex + 1} 試行${retry + 1} [${tweetType}] スコア${scoreData.average.toFixed(1)}: ${postText.substring(0, 40)}...`);

    if (scoreData.average >= 7.0 && scoreData.average > bestScore) {
      bestPost = { text: postText, score: scoreData, pattern_id: selectedPattern?.id, hook_id: selectedHook?.id, theme: selectedTheme, tweet_type: tweetType, research_id: researchItem?.id || null };
      bestScore = scoreData.average;
      break;
    }

    if (!bestPost || scoreData.average > bestScore) {
      bestPost = { text: postText, score: scoreData, pattern_id: selectedPattern?.id, hook_id: selectedHook?.id, theme: selectedTheme, tweet_type: tweetType, research_id: researchItem?.id || null };
      bestScore = scoreData.average;
    }
  }

  if (bestScore < 7.0) {
    console.log(`  [writer] 投稿#${postIndex + 1} 棄却（スコア${bestScore.toFixed(1)}）`);
    return null;
  }

  if (researchItem) researchItem.used = true;
  return bestPost;
}

function isSimilar(newText, historyTexts) {
  for (const old of historyTexts.slice(-100)) {
    const newWords = new Set(newText.split(/\s+/));
    const oldWords = new Set(old.split(/\s+/));
    const intersection = [...newWords].filter(w => oldWords.has(w)).length;
    const union = new Set([...newWords, ...oldWords]).size;
    if (union > 0 && intersection / union > 0.6) return true;
  }
  return false;
}

async function run(count = 5) {
  console.log(`[writer] 投稿生成開始（${count}本）...`);

  const persona = readJSON(path.join(KNOWLEDGE_DIR, 'persona.json'), {});
  const patterns = readJSON(path.join(KNOWLEDGE_DIR, 'patterns.json'), { patterns: [] });
  const hooks = readJSON(path.join(KNOWLEDGE_DIR, 'hooks.json'), { hooks: [] });
  const buzzRef = readJSON(path.join(KNOWLEDGE_DIR, 'buzz_references.json'), {});
  const history = readJSON(path.join(DATA_DIR, 'post_history.json'));
  const feedback = readJSON(path.join(DATA_DIR, 'analyst_feedback.json'), null);
  const researchPool = readJSON(path.join(DATA_DIR, 'research_pool.json'));
  const queue = readJSON(path.join(DATA_DIR, 'queue.json'));

  const historyTexts = history.map(h => h.text);
  const generated = [];

  for (let i = 0; i < count; i++) {
    if (i > 0) {
      console.log(`  [writer] レートリミット回避: 65秒待機...`);
      await new Promise(r => setTimeout(r, 65000));
    }
    try {
      const post = await generatePost(persona, patterns, hooks, buzzRef, [...history, ...generated], feedback, researchPool, i);
      if (!post) continue;

      if (isSimilar(post.text, [...historyTexts, ...generated.map(g => g.text)])) {
        console.log(`  [writer] 投稿#${i + 1} 類似投稿あり、スキップ`);
        continue;
      }

      generated.push(post);
      console.log(`  [writer] 投稿#${i + 1} 合格 (スコア: ${post.score.average.toFixed(1)})`);
    } catch (err) {
      console.error(`  [writer] 投稿#${i + 1} エラー: ${err.message}`);
    }
  }

  const newQueue = [...queue, ...generated.map(g => ({
    id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    text: g.text,
    score: g.score,
    pattern_id: g.pattern_id,
    hook_id: g.hook_id,
    theme: g.theme,
    tweet_type: g.tweet_type,
    research_id: g.research_id,
    created_at: new Date().toISOString()
  }))];

  writeJSON(path.join(DATA_DIR, 'queue.json'), newQueue);
  writeJSON(path.join(DATA_DIR, 'research_pool.json'), researchPool);

  console.log(`[writer] 完了: ${generated.length}本生成、キュー残: ${newQueue.length}本`);
  return generated;
}

module.exports = { run };

if (require.main === module) {
  const count = parseInt(process.argv[2]) || 5;
  run(count).catch(console.error);
}
