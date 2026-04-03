/**
 * 社員4: 引用ポスター（quote-poster）
 * バズ投稿に独自コメントを付けて引用リツイート
 * 1日5件（morning:2 / noon:2 / evening:1）
 * 既存 agents/retweeter.js を補完
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { searchBuzzTweets } = require('../../lib/grok-client');
const { createWithRetry } = require('../../lib/anthropic-client');
const { quoteTweet } = require('../../lib/x-api');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CANDIDATES_FILE = path.join(DATA_DIR, 'retweet_candidates.json');
const HISTORY_FILE = path.join(DATA_DIR, 'retweet_history.json');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'quote-poster.log');

const MIN_SCORE = 7.0;
const MIN_INTERVAL_MS = 30 * 60 * 1000; // 30分

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

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * 引用済みツイートIDを取得
 */
function getQuotedIds(history) {
  return new Set(history.map(h => h.original_tweet_id || h.tweet_id));
}

/**
 * バズ投稿候補を収集（Grok + 既存candidates）
 */
async function collectCandidates(quotedIds) {
  const candidates = [];

  // 1. 既存のretweet_candidates.jsonから
  const existing = loadJson(CANDIDATES_FILE, []);
  for (const c of existing) {
    const id = c.tweet_id || c.id;
    if (id && !quotedIds.has(id)) {
      candidates.push({ tweet_id: id, context: c.context || c.text || '' });
    }
  }

  // 2. Grok追加検索
  try {
    const buzzMap = await searchBuzzTweets(
      `直近6時間でバズっている日本語の投資・株・マーケット関連ツイートを5件見つけてください。` +
      `いいね50以上 or RT20以上の投稿を優先。炎上・政治系は除外。`,
      6
    );
    for (const [tweetId, context] of buzzMap) {
      if (!quotedIds.has(tweetId) && !candidates.find(c => c.tweet_id === tweetId)) {
        candidates.push({ tweet_id: tweetId, context });
      }
    }
  } catch (err) {
    log(`Grok検索エラー: ${err.message}`);
  }

  return candidates;
}

/**
 * Claude APIで引用コメントを生成
 */
async function generateQuoteComment(tweetContext) {
  const systemPrompt = `あなたは投資分析アカウント「kaizokuokabu」として引用リツイートのコメントを書きます。

## トーン（ゆきママ風）
- 断定的だが有益
- データで裏付け
- 読者への問いかけを入れる
- 140文字以内

## コメントパターン（いずれかを選択）
1. 反論型: 「一見正しそうだけど、〇〇を考慮すると違う景色が見える」
2. 深掘り型: 「ここまでは同意。でも本当に重要なのは〇〇の方」
3. 追加データ型: 「これに加えて〇〇のデータも見ると面白い」
4. 予測型: 「この流れが続くと、次に来るのは〇〇だと思ってる」

## 禁止
- 元ツイートの要約だけ
- 「いいこと言ってる！」だけの薄いコメント
- 特定銘柄の買い/売り推奨

## 出力形式（JSON）
{
  "comment": "引用コメント本文",
  "pattern": "反論型 | 深掘り型 | 追加データ型 | 予測型",
  "score": 7.5
}`;

  const response = await createWithRetry({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: `以下の投稿を引用RTするコメントを生成してください:\n\n${tweetContext}` }],
  });

  const text = response.content[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* fallthrough */ }
  }
  return null;
}

/**
 * メイン実行
 */
async function run(count = 2) {
  log(`=== quote-poster 開始（${count}件予定）===`);

  const killFile = path.join(DATA_DIR, 'KILL_SWITCH');
  if (fs.existsSync(killFile)) {
    log('KILL_SWITCH有効 → 停止');
    return [];
  }

  const history = loadJson(HISTORY_FILE, []);
  const quotedIds = getQuotedIds(history);

  // 候補収集
  const candidates = await collectCandidates(quotedIds);
  log(`引用候補: ${candidates.length}件`);

  if (candidates.length === 0) {
    log('引用候補なし → 終了');
    return [];
  }

  const results = [];

  for (const candidate of candidates.slice(0, count + 2)) {
    if (results.length >= count) break;

    log(`引用候補: ${candidate.tweet_id}`);

    // コメント生成
    const quote = await generateQuoteComment(candidate.context);
    if (!quote || !quote.comment) {
      log('  → コメント生成失敗');
      continue;
    }

    if (quote.score < MIN_SCORE) {
      log(`  → スコア不足: ${quote.score}`);
      continue;
    }

    log(`  → コメント: "${quote.comment}" (score: ${quote.score})`);

    // 引用リツイート投稿
    const result = await quoteTweet(quote.comment, candidate.tweet_id);
    if (result) {
      const record = {
        original_tweet_id: candidate.tweet_id,
        quote_tweet_id: result.id,
        comment: quote.comment,
        pattern: quote.pattern,
        score: quote.score,
        posted_at: new Date().toISOString(),
      };
      results.push(record);
      history.unshift(record);
      log(`  → ✅ 引用RT成功: ${result.id}`);

      // 30分間隔
      if (results.length < count) {
        log(`  → 次の引用まで30分待機`);
        await new Promise(r => setTimeout(r, MIN_INTERVAL_MS));
      }
    } else {
      log(`  → ❌ 引用RT失敗`);
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  // 履歴保存
  saveJson(HISTORY_FILE, history.slice(0, 500));
  log(`=== quote-poster 完了: ${results.length}件引用RT ===`);
  return results;
}

if (require.main === module) {
  const count = parseInt(process.argv[2]) || 2;
  run(count).then(results => {
    console.log(`\n✅ ${results.length}件の引用RTを投稿しました`);
  }).catch(err => {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { run };
