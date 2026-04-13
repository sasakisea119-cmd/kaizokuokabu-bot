/**
 * CTAツイート一括投稿スクリプト
 * 引数でモードを指定:
 *   node scripts/post-cta-batch.js first3   → 最初の3本を投稿
 *   node scripts/post-cta-batch.js all      → 全CTA投稿（20分間隔）
 *   node scripts/post-cta-batch.js next N   → 次のN本を投稿
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { postTweet } = require('../lib/x-api');

const QUEUE_PATH = path.join(__dirname, '..', 'data', 'queue.json');
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'post_history.json');
const INTERVAL_MS = 20 * 60 * 1000; // 20分間隔

function readJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const mode = process.argv[2] || 'first3';
  const count = mode === 'next' ? parseInt(process.argv[3] || '3', 10) : (mode === 'all' ? 999 : 3);

  const queue = readJSON(QUEUE_PATH, []);
  const history = readJSON(HISTORY_PATH, []);

  // CTAツイートだけ抽出
  const ctaTweets = queue.filter(t => t.tweet_type === 'cta_note');

  // 既に投稿済みのIDを除外
  const postedIds = new Set(history.map(h => h.id));
  const pending = ctaTweets.filter(t => !postedIds.has(t.id));

  const toPost = pending.slice(0, count);

  console.log(`\n📢 CTA投稿バッチ開始`);
  console.log(`  待機中: ${pending.length}本`);
  console.log(`  今回投稿: ${toPost.length}本`);
  console.log(`  間隔: ${INTERVAL_MS / 60000}分\n`);

  for (let i = 0; i < toPost.length; i++) {
    const tweet = toPost[i];
    console.log(`[${i + 1}/${toPost.length}] 投稿中: ${tweet.id}`);
    console.log(`  テーマ: ${tweet.theme}`);
    console.log(`  本文: ${tweet.text.substring(0, 60)}...`);

    try {
      const result = await postTweet(tweet.text);
      if (result && result.id) {
        console.log(`  ✅ 投稿成功: https://x.com/kaizokuokabu/status/${result.id}`);

        // 履歴に追加
        history.push({
          id: tweet.id,
          tweet_id: result.id,
          text: tweet.text,
          theme: tweet.theme,
          tweet_type: tweet.tweet_type,
          posted_at: new Date().toISOString()
        });
        writeJSON(HISTORY_PATH, history);

        // キューから削除
        const queueData = readJSON(QUEUE_PATH, []);
        const updatedQueue = queueData.filter(q => q.id !== tweet.id);
        writeJSON(QUEUE_PATH, updatedQueue);
      } else {
        console.log(`  ❌ 投稿失敗（レスポンス不正）`);
      }
    } catch (err) {
      console.error(`  ❌ エラー: ${err.message}`);
    }

    // 最後のツイート以外は間隔を空ける
    if (i < toPost.length - 1) {
      console.log(`  ⏳ ${INTERVAL_MS / 60000}分待機...\n`);
      await sleep(INTERVAL_MS);
    }
  }

  console.log(`\n✅ バッチ完了。${toPost.length}本投稿。`);
}

main().catch(console.error);
