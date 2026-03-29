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

// パターン選択（直近3件と被らない）
function selectPattern(patterns, history) {
  const recent3 = history.slice(-3).map(h => h.pattern_id);
  const available = patterns.filter(p => !recent3.includes(p.id));
  if (available.length === 0) return patterns[Math.floor(Math.random() * patterns.length)];
  return available[Math.floor(Math.random() * available.length)];
}

// フック選択（直近5件と被らない）
function selectHook(hooks, history) {
  const recent5 = history.slice(-5).map(h => h.hook_id);
  const available = hooks.filter(h => !recent5.includes(h.id));
  if (available.length === 0) return hooks[Math.floor(Math.random() * hooks.length)];
  return available[Math.floor(Math.random() * available.length)];
}

// テーマ選択（3回連続禁止）
function selectTheme(themes, history) {
  const recent3 = history.slice(-3).map(h => h.theme);
  // 全部同じテーマなら除外
  if (recent3.length === 3 && recent3.every(t => t === recent3[0])) {
    const filtered = themes.filter(t => t !== recent3[0]);
    if (filtered.length > 0) return filtered[Math.floor(Math.random() * filtered.length)];
  }
  return themes[Math.floor(Math.random() * themes.length)];
}

async function generatePost(persona, patterns, hooks, buzzRef, history, feedback, researchPool, postIndex) {
  const selectedPattern = selectPattern(patterns.patterns, history);
  const selectedHook = selectHook(hooks.hooks, history);
  const themes = persona.themes?.main_categories || [];
  const selectedTheme = selectTheme(themes, history);

  // research_poolから未使用のネタを取得（urgency=highを優先）
  let researchItem = null;
  if (researchPool.length > 0) {
    const unused = researchPool.filter(r => !r.used);
    const highUrgency = unused.filter(r => r.urgency === 'high');
    researchItem = highUrgency.length > 0 ? highUrgency[0] : (unused.length > 0 ? unused[0] : null);
  }

  const systemPrompt = `あなたはX（旧Twitter）の投資アカウント「kaizokuokabu」として投稿を作成するAIです。

## ペルソナ
${JSON.stringify(persona, null, 2)}

## 特にvirality_principles（バズの原則）を熟読して従ってください
${JSON.stringify(persona.virality_principles, null, 2)}

## 今回使用するパターン
${JSON.stringify(selectedPattern, null, 2)}

## 今回使用するフック（1行目）
${JSON.stringify(selectedHook, null, 2)}

## バズ戦略
${JSON.stringify(buzzRef.virality_strategy, null, 2)}

## 構造パターン
${JSON.stringify(buzzRef.structural_patterns, null, 2)}

${researchItem ? `## 今回のネタ（最新リサーチ）\n${JSON.stringify(researchItem, null, 2)}` : ''}

${feedback ? `## アナリストからのフィードバック\n${JSON.stringify(feedback, null, 2)}` : ''}

## ルール
- 280文字以内（厳守）
- 免責文は不要（プロフィールに記載済み）
- ハッシュタグは0〜2個（多すぎるとスパム扱い）
- 数字を必ず含める（具体的なデータが説得力を生む）
- 1行目でスクロールを止めさせる（フックを使う）
- バズることを最優先に。感情を揺さぶる＋データで裏付ける構成にして
- 特定銘柄の「買い推奨」「売り推奨」はしない（分析・解説に留める）
- テーマ：${selectedTheme}

投稿テキストだけを出力してください。余計な説明は不要です。`;

  let bestPost = null;
  let bestScore = 0;

  for (let retry = 0; retry < 3; retry++) {
    const response = await createWithRetry({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `投稿 #${postIndex + 1} を生成してください。テーマ: ${selectedTheme}` }],
      system: systemPrompt
    });

    const postText = response.content[0].text.trim();

    // 自己採点
    const scoreResponse = await createWithRetry({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `以下の投稿を10項目×10点で採点してください。各項目の点数と平均点をJSON形式で返してください。

投稿：
${postText}

採点項目：
1. バズ力（リツイートされそうか）
2. フック力（1行目で止まるか）
3. 有益性（読む価値があるか）
4. データ具体性（数字が効果的か）
5. 独自性（他と差別化できているか）
6. 議論誘発力（リプが来そうか）
7. 保存したくなるか（ブックマーク率）
8. テンポ（読みやすいか）
9. ペルソナ一致（kaizokuokabuらしいか）
10. NGワード非含有（投資助言に当たらないか）

回答形式（JSONのみ）：
{"scores":{"buzz":X,"hook":X,"value":X,"data":X,"unique":X,"discussion":X,"bookmark":X,"tempo":X,"persona":X,"ng_check":X},"average":X.X}`
      }],
      system: 'JSONのみ出力してください。'
    });

    let scoreData;
    try {
      const scoreText = scoreResponse.content[0].text.trim();
      const jsonMatch = scoreText.match(/\{[\s\S]*\}/);
      scoreData = JSON.parse(jsonMatch[0]);
    } catch {
      scoreData = { average: 5.0, scores: {} };
    }

    console.log(`  [writer] 投稿#${postIndex + 1} 試行${retry + 1}: スコア ${scoreData.average} - ${postText.substring(0, 50)}...`);

    if (scoreData.average >= 7.0 && scoreData.average > bestScore) {
      bestPost = {
        text: postText,
        score: scoreData,
        pattern_id: selectedPattern.id,
        hook_id: selectedHook.id,
        theme: selectedTheme,
        research_id: researchItem?.id || null
      };
      bestScore = scoreData.average;
      break; // 7.0以上なら合格
    }

    if (!bestPost || scoreData.average > bestScore) {
      bestPost = {
        text: postText,
        score: scoreData,
        pattern_id: selectedPattern.id,
        hook_id: selectedHook.id,
        theme: selectedTheme,
        research_id: researchItem?.id || null
      };
      bestScore = scoreData.average;
    }
  }

  // 7.0未満は棄却
  if (bestScore < 7.0) {
    console.log(`  [writer] 投稿#${postIndex + 1} 棄却（スコア ${bestScore}）`);
    return null;
  }

  // リサーチアイテムをusedに
  if (researchItem) {
    researchItem.used = true;
  }

  return bestPost;
}

// 簡易類似度チェック
function isSimilar(newText, historyTexts) {
  for (const old of historyTexts.slice(-100)) {
    // 単純なJaccard類似度
    const newWords = new Set(newText.split(/\s+/));
    const oldWords = new Set(old.split(/\s+/));
    const intersection = [...newWords].filter(w => oldWords.has(w)).length;
    const union = new Set([...newWords, ...oldWords]).size;
    if (union > 0 && intersection / union > 0.6) return true;
  }
  return false;
}

async function run() {
  console.log('[writer] 投稿生成開始...');

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

  for (let i = 0; i < 5; i++) {
    // レートリミット回避: 2本目以降は65秒待機
    if (i > 0) {
      console.log(`  [writer] レートリミット回避: 65秒待機...`);
      await new Promise(r => setTimeout(r, 65000));
    }
    try {
      const post = await generatePost(
        persona, patterns, hooks, buzzRef, [...history, ...generated],
        feedback, researchPool, i
      );

      if (!post) continue;

      // 類似度チェック
      if (isSimilar(post.text, [...historyTexts, ...generated.map(g => g.text)])) {
        console.log(`  [writer] 投稿#${i + 1} 類似投稿あり、スキップ`);
        continue;
      }

      generated.push(post);
      console.log(`  [writer] 投稿#${i + 1} 合格 (スコア: ${post.score.average})`);
    } catch (err) {
      console.error(`  [writer] 投稿#${i + 1} エラー: ${err.message}`);
    }
  }

  // キューに追加
  const newQueue = [...queue, ...generated.map(g => ({
    id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    text: g.text,
    score: g.score,
    pattern_id: g.pattern_id,
    hook_id: g.hook_id,
    theme: g.theme,
    research_id: g.research_id,
    created_at: new Date().toISOString()
  }))];

  writeJSON(path.join(DATA_DIR, 'queue.json'), newQueue);

  // research_poolの更新（usedフラグ）
  writeJSON(path.join(DATA_DIR, 'research_pool.json'), researchPool);

  console.log(`[writer] 完了: ${generated.length}本生成、キュー残: ${newQueue.length}本`);
  return generated;
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
