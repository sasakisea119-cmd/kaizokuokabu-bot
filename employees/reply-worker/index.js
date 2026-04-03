/**
 * 社員2: リプライワーカー（reply-worker）
 * ターゲットアカウントの投稿に自然なリプライを自動生成・投稿
 * 1日6〜9リプライ（1回2〜3件 × 3回）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { searchX } = require('../../lib/grok-client');
const { createWithRetry } = require('../../lib/anthropic-client');
const { replyToTweet } = require('../../lib/x-api');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TARGET_FILE = path.join(DATA_DIR, 'target_accounts.json');
const REPLY_HISTORY_FILE = path.join(DATA_DIR, 'reply_history.json');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'reply-worker.log');

const REPLIES_PER_RUN = 3;    // 1回あたりのリプライ数
const MIN_SCORE = 7.0;        // 品質スコア閾値
const MIN_INTERVAL_MS = 10 * 60 * 1000; // リプライ間隔: 最低10分

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
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch { /* ignore */ }
  return fallback;
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * 今日すでにリプライしたアカウントを取得
 */
function getTodayRepliedAccounts(history) {
  const today = new Date().toISOString().split('T')[0];
  return new Set(
    history
      .filter(r => r.replied_at && r.replied_at.startsWith(today))
      .map(r => r.target_username.toLowerCase())
  );
}

/**
 * Grok x_search でターゲットの最新投稿を取得
 */
async function findRecentTweets(account) {
  const username = account.username.replace('@', '');
  const prompt =
    `Xユーザー @${username} の直近12時間の投稿を探してください。` +
    `投資・株・マーケットに関する投稿を優先してください。` +
    `各投稿のツイートIDとURL、内容の要約を教えてください。`;

  try {
    const text = await searchX(prompt, 12);
    // ツイートURLからIDを抽出
    const tweetPattern = /https?:\/\/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/g;
    const tweets = [];
    let match;
    while ((match = tweetPattern.exec(text)) !== null) {
      const start = Math.max(0, match.index - 150);
      const end = Math.min(text.length, match.index + match[0].length + 100);
      const context = text.substring(start, end).trim();
      tweets.push({ tweet_id: match[1], context, url: match[0] });
    }
    return tweets;
  } catch (err) {
    log(`[findRecentTweets] @${username} 検索エラー: ${err.message}`);
    return [];
  }
}

/**
 * Claude APIでリプライテキストを生成 + スコアリング
 */
async function generateReply(targetUsername, tweetContext) {
  const systemPrompt = `あなたは投資分析アカウント「kaizokuokabu」としてXでリプライを書きます。

## トーン
- 少し丁寧だが、親しみやすい口調
- 共感ベース（「それ、俺も同じこと思ってた」系）
- 具体的な数字やデータに触れて信頼感を出す
- 短め（100文字以内が理想）

## リプライパターン（いずれかを使う）
1. 共感+追加情報: 「わかる。しかも〇〇のデータ見ると〜」
2. 質問型: 「これ〇〇の場合はどう見てる？」
3. 補足型: 「補足すると、〇〇も注目で〜」
4. 感想型: 「この視点は盲点だった。〇〇も気になる」

## 禁止事項
- 宣伝・自分のアカウントへの誘導
- 「フォローしました！」系
- 全否定
- 自分のツイートへのリンク

## 出力形式（JSON）
{
  "reply_text": "リプライ本文",
  "pattern": "共感+追加情報 | 質問型 | 補足型 | 感想型",
  "score": 7.5
}`;

  const userPrompt = `以下の投稿にリプライを生成してください。

対象アカウント: ${targetUsername}
投稿内容/コンテキスト:
${tweetContext}

JSON形式で1つだけ出力してください。`;

  const response = await createWithRetry({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0]?.text || '';
  // JSONを抽出
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch { /* fallthrough */ }
  }
  return null;
}

/**
 * メイン実行
 */
async function run(count) {
  const replyCount = count || REPLIES_PER_RUN;
  log(`=== reply-worker 開始（${replyCount}件予定）===`);

  // ターゲットアカウント読み込み
  const targets = loadJson(TARGET_FILE, []);
  if (targets.length === 0) {
    log('ターゲットアカウントがありません。account-selectorを先に実行してください。');
    return [];
  }

  // リプライ履歴読み込み
  const history = loadJson(REPLY_HISTORY_FILE, []);
  const todayReplied = getTodayRepliedAccounts(history);

  // 今日まだリプライしていないアカウントを優先
  const available = targets
    .filter(a => !todayReplied.has(a.username.toLowerCase().replace('@', '')))
    .sort((a, b) => {
      const prio = { high: 0, medium: 1, low: 2 };
      return (prio[a.priority] || 2) - (prio[b.priority] || 2);
    });

  log(`利用可能ターゲット: ${available.length}/${targets.length}`);

  const results = [];
  let lastReplyTime = 0;

  for (const account of available.slice(0, replyCount + 2)) {
    if (results.length >= replyCount) break;

    // 間隔チェック
    const now = Date.now();
    const elapsed = now - lastReplyTime;
    if (lastReplyTime > 0 && elapsed < MIN_INTERVAL_MS) {
      const waitMs = MIN_INTERVAL_MS - elapsed;
      log(`間隔待機: ${Math.round(waitMs / 1000)}秒`);
      await new Promise(r => setTimeout(r, waitMs));
    }

    log(`ターゲット: ${account.username}`);

    // 最新投稿を検索
    const tweets = await findRecentTweets(account);
    if (tweets.length === 0) {
      log(`  → 最近の投稿なし、スキップ`);
      continue;
    }

    // 最初のツイートにリプライ
    const tweet = tweets[0];
    log(`  → ツイートID: ${tweet.tweet_id}`);

    // リプライ生成
    const reply = await generateReply(account.username, tweet.context);
    if (!reply || !reply.reply_text) {
      log(`  → リプライ生成失敗`);
      continue;
    }

    if (reply.score < MIN_SCORE) {
      log(`  → スコア不足: ${reply.score} < ${MIN_SCORE}`);
      continue;
    }

    log(`  → リプライ: "${reply.reply_text}" (score: ${reply.score}, pattern: ${reply.pattern})`);

    // X APIでリプライ投稿
    const result = await replyToTweet(reply.reply_text, tweet.tweet_id);
    if (result) {
      const record = {
        target_username: account.username,
        target_tweet_id: tweet.tweet_id,
        reply_tweet_id: result.id,
        reply_text: reply.reply_text,
        pattern: reply.pattern,
        score: reply.score,
        replied_at: new Date().toISOString(),
      };
      results.push(record);
      history.unshift(record);
      lastReplyTime = Date.now();
      log(`  → ✅ リプライ投稿成功: ${result.id}`);
    } else {
      log(`  → ❌ リプライ投稿失敗`);
    }

    // API負荷軽減
    await new Promise(r => setTimeout(r, 5000));
  }

  // 履歴保存（最大500件）
  saveJson(REPLY_HISTORY_FILE, history.slice(0, 500));
  log(`=== reply-worker 完了: ${results.length}件リプライ ===`);
  return results;
}

if (require.main === module) {
  const count = parseInt(process.argv[2]) || REPLIES_PER_RUN;
  run(count).then(results => {
    console.log(`\n✅ ${results.length}件のリプライを投稿しました`);
  }).catch(err => {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { run };
