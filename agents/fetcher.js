require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { getTweetMetrics } = require('../lib/x-api');

const DATA_DIR = path.join(__dirname, '..', 'data');

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('[fetcher] メトリクス取得開始...');

  const historyPath = path.join(DATA_DIR, 'post_history.json');
  const history = readJSON(historyPath);

  if (history.length === 0) {
    console.log('[fetcher] 投稿履歴がありません。');
    return;
  }

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  // 24時間以上経過＋メトリクス未取得
  const targets = history.filter(h => {
    const postedAt = new Date(h.posted_at).getTime();
    return (now - postedAt >= ONE_DAY) && !h.fetched_at;
  });

  if (targets.length === 0) {
    console.log('[fetcher] 取得対象なし。');
    return;
  }

  console.log(`[fetcher] ${targets.length}件のメトリクスを取得します...`);
  let fetched = 0;

  for (const post of targets) {
    try {
      const metrics = await getTweetMetrics(post.tweet_id);

      if (metrics) {
        post.metrics = metrics;
        post.fetched_at = new Date().toISOString();
        fetched++;
        console.log(`  [fetcher] ${post.tweet_id}: imp=${metrics.impressions} like=${metrics.likes} rt=${metrics.retweets}`);
      }
    } catch (err) {
      console.error(`  [fetcher] ${post.tweet_id} エラー: ${err.message}`);
    }

    // 2秒間隔
    await sleep(2000);
  }

  writeJSON(historyPath, history);
  console.log(`[fetcher] 完了: ${fetched}/${targets.length}件取得`);
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
