require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { postTweet } = require('../lib/x-api');
const { findDuplicate } = require('../lib/dedup');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEDUP_HOURS = 48;       // 過去48時間の投稿と比較
const DEDUP_MAX_SKIPS = 5;    // 1回のpostOneで最大5件まで重複スキップ
const DAILY_POST_LIMIT = 4;   // 直近24hに4件以上投稿していたらスキップ（連投防止）

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

  // === 連投防止ガード ===
  // 直近24hに DAILY_POST_LIMIT 件以上投稿していたらスキップ
  const history = readJSON(path.join(DATA_DIR, 'post_history.json'));
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const last24hCount = history.filter(h => {
    const ts = new Date(h.posted_at || 0).getTime();
    return ts >= dayAgo;
  }).length;
  if (last24hCount >= DAILY_POST_LIMIT) {
    console.log(`[poster] 直近24hに${last24hCount}件投稿済み（上限${DAILY_POST_LIMIT}）。連投防止のためスキップ`);
    return null;
  }

  // === 重複防止ガード ===
  // 直近DEDUP_HOURS時間に類似テキストがあればキューから捨てて次へ
  let skipped = 0;
  let item = null;
  while (queue.length > 0 && skipped < DEDUP_MAX_SKIPS) {
    const candidate = queue[0];
    const dup = findDuplicate(candidate.text, history, { hours: DEDUP_HOURS });
    if (!dup.isDuplicate) {
      item = candidate;
      break;
    }
    console.warn(`[poster] 重複検出 → スキップ (${dup.reason}): ${candidate.text.substring(0, 40)}...`);
    queue.shift();
    skipped++;
  }
  if (skipped > 0) {
    writeJSON(path.join(DATA_DIR, 'queue.json'), queue);
  }
  if (!item) {
    console.log(`[poster] 重複スキップで投稿候補なし (skipped=${skipped})`);
    return null;
  }

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
