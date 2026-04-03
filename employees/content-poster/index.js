/**
 * 社員5: コンテンツポスター（content-poster）
 * オリジナル投稿を生成してキューに追加
 * 既存 agents/writer.js を拡張（ブランドボイス＋テーマ連携）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { createWithRetry } = require('../../lib/anthropic-client');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const KNOWLEDGE_DIR = path.join(__dirname, '..', '..', 'knowledge');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const FEEDBACK_FILE = path.join(DATA_DIR, 'analyst_feedback.json');
const RESEARCH_FILE = path.join(DATA_DIR, 'research_pool.json');
const HISTORY_FILE = path.join(DATA_DIR, 'post_history.json');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'content-poster.log');

const MIN_SCORE = 7.0;

function log(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  console.log(line.trim());
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* ignore */ }
}

function loadJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { /* ignore */ }
  return fallback;
}

function loadText(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch { /* ignore */ }
  return '';
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * 投稿タイプを選択（A/Bテスト結果で調整）
 */
function selectTweetType(feedback) {
  const ratio = feedback?.tweet_type_ratio || {
    standard: 40,
    short_personal: 25,
    contrarian: 20,
    note_cta: 15,
  };

  const total = Object.values(ratio).reduce((s, v) => s + v, 0);
  const rand = Math.random() * total;
  let cum = 0;
  for (const [type, weight] of Object.entries(ratio)) {
    cum += weight;
    if (rand < cum) return type;
  }
  return 'standard';
}

/**
 * 今日の曜日に合ったテーマを取得
 */
function getTodayTheme() {
  const weeklyTheme = loadText(path.join(CONFIG_DIR, 'weekly-theme.md'));
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const today = days[new Date().getDay()];
  // テーマMDから当日行を抽出
  const lines = weeklyTheme.split('\n');
  for (const line of lines) {
    if (line.includes(`| ${today} |`)) {
      return line;
    }
  }
  return '';
}

/**
 * Claude APIで投稿を生成+スコアリング（1回のAPI呼び出し）
 */
async function generateTweet(tweetType, research, theme) {
  const brandVoice = loadText(path.join(CONFIG_DIR, 'brand-voice.md'));
  const persona = loadText(path.join(KNOWLEDGE_DIR, 'persona.json'));
  const patterns = loadText(path.join(KNOWLEDGE_DIR, 'patterns.json'));
  const hooks = loadText(path.join(KNOWLEDGE_DIR, 'hooks.json'));

  const typeInstructions = {
    standard: `データ分析・市場解説型。具体的な数字やデータを含めて信頼感を出す。150〜280文字。`,
    short_personal: `親近感・本音系。短く（80文字以内）率直な感想や気づき。「正直に言うと〜」「ぶっちゃけ〜」系。`,
    contrarian: `逆張り・常識を覆す系。「〜だと思ってる人、まだいるの？」「分かってない奴多すぎ」系。データで裏付け。`,
    note_cta: `長文記事への誘導。注目ポイントを1〜2個出して「詳しくはこちら👇」で締める。`,
  };

  const systemPrompt = `あなたは投資分析Xアカウント「kaizokuokabu」のライターです。

## ブランドボイス
${brandVoice.substring(0, 1500)}

## ペルソナ
${persona.substring(0, 500)}

## 投稿パターン
${patterns.substring(0, 500)}

## フック集
${hooks.substring(0, 500)}

## 今回の投稿タイプ: ${tweetType}
${typeInstructions[tweetType] || typeInstructions.standard}

## キャッシュタグ最適化
- 日本株: $7203, $9984, $6758 等（証券コード）
- 米国株: $NVDA, $AAPL, $TSLA 等（ティッカー）
- 1投稿1〜2個が最適

## 禁止事項
- 特定銘柄の買い/売り推奨
- 免責文・注意書き
- 「〜かもしれません」等の弱い表現
- 絵文字3個以上

## 出力形式（JSON）
{
  "text": "投稿本文",
  "tweet_type": "${tweetType}",
  "score": 7.5,
  "theme": "テーマ名",
  "cashtags": ["$NVDA"]
}`;

  const userPrompt = `以下の情報を参考に、${tweetType}タイプの投稿を1つ生成してください。

## 今日のテーマ
${theme || '特になし（自由テーマ）'}

## 最新リサーチ情報
${research.substring(0, 2000)}

JSON形式で出力してください。`;

  const response = await createWithRetry({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* fallthrough */ }
  }
  return null;
}

/**
 * 重複チェック（直近の投稿と類似していないか）
 */
function isDuplicate(newText, history) {
  const recent = history.slice(0, 15);
  for (const post of recent) {
    const existingText = post.text || post.tweet_text || '';
    if (!existingText) continue;
    // 簡易類似度チェック（先頭30文字一致）
    if (newText.substring(0, 30) === existingText.substring(0, 30)) return true;
  }
  return false;
}

/**
 * メイン実行
 */
async function run(count = 5) {
  log(`=== content-poster 開始（${count}件生成予定）===`);

  const feedback = loadJson(FEEDBACK_FILE, {});
  const research = loadText(RESEARCH_FILE) || '最新リサーチ情報なし';
  const history = loadJson(HISTORY_FILE, []);
  const queue = loadJson(QUEUE_FILE, []);
  const theme = getTodayTheme();

  log(`テーマ: ${theme || 'フリー'}`);
  log(`現在のキュー: ${queue.length}件`);

  const generated = [];
  let attempts = 0;
  const maxAttempts = count * 2; // 棄却分を見越して多めに試行

  while (generated.length < count && attempts < maxAttempts) {
    attempts++;
    const tweetType = selectTweetType(feedback);
    log(`生成中 (${generated.length + 1}/${count}) タイプ: ${tweetType}`);

    try {
      const tweet = await generateTweet(tweetType, research, theme);
      if (!tweet || !tweet.text) {
        log('  → 生成失敗');
        continue;
      }

      if (tweet.score < MIN_SCORE) {
        log(`  → スコア不足: ${tweet.score}`);
        continue;
      }

      if (isDuplicate(tweet.text, [...history, ...generated])) {
        log(`  → 重複検出、スキップ`);
        continue;
      }

      const entry = {
        text: tweet.text,
        tweet_type: tweet.tweet_type || tweetType,
        score: tweet.score,
        theme: tweet.theme || '',
        cashtags: tweet.cashtags || [],
        generated_at: new Date().toISOString(),
        source: 'content-poster',
      };

      generated.push(entry);
      log(`  → ✅ "${tweet.text.substring(0, 50)}..." (score: ${tweet.score})`);

      // API負荷軽減
      await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      log(`  → エラー: ${err.message}`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  // キューに追加
  const updatedQueue = [...queue, ...generated];
  saveJson(QUEUE_FILE, updatedQueue);

  log(`=== content-poster 完了: ${generated.length}件生成、キュー合計${updatedQueue.length}件 ===`);
  return generated;
}

if (require.main === module) {
  const count = parseInt(process.argv[2]) || 5;
  run(count).then(results => {
    console.log(`\n✅ ${results.length}件の投稿をキューに追加しました`);
  }).catch(err => {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { run };
