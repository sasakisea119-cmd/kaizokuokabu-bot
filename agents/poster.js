require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { postTweet } = require('../lib/x-api');

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

function isKillSwitchOn() {
  const killFile = path.join(DATA_DIR, 'KILL_SWITCH');
  return fs.existsSync(killFile);
}

async function postOne() {
  // KILL_SWITCHチェック
  if (isKillSwitchOn()) {
    console.log('[poster] KILL_SWITCHが有効です。投稿を中止します。');
    return null;
  }

  const queue = readJSON(path.join(DATA_DIR, 'queue.json'));
  if (queue.length === 0) {
    console.log('[poster] キューが空です。');
    return null;
  }

  // 最古の1件を取得
  const item = queue[0];
  console.log(`[poster] 投稿中: ${item.text.substring(0, 50)}...`);

  const result = await postTweet(item.text);

  if (result) {
    // 成功→post_historyに記録
    const history = readJSON(path.join(DATA_DIR, 'post_history.json'));
    history.push({
      tweet_id: result.id,
      text: item.text,
      score: item.score,
      pattern_id: item.pattern_id,
      hook_id: item.hook_id,
      theme: item.theme,
      research_id: item.research_id || null,
      posted_at: new Date().toISOString(),
      metrics: null,
      fetched_at: null
    });
    writeJSON(path.join(DATA_DIR, 'post_history.json'), history);

    // キューから削除
    queue.shift();
    writeJSON(path.join(DATA_DIR, 'queue.json'), queue);

    console.log(`[poster] 投稿成功: ${result.id}`);
    return result;
  }

  // 重複投稿の場合はキューから削除
  queue.shift();
  writeJSON(path.join(DATA_DIR, 'queue.json'), queue);

  console.error('[poster] 投稿失敗。キューから削除しました。');
  return null;
}

module.exports = { postOne };

if (require.main === module) {
  postOne().catch(console.error);
}
