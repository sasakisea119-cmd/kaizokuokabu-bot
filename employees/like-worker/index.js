/**
 * 社員3: いいねワーカー（like-worker）
 * ターゲットアカウントの投稿に戦略的いいねを付ける
 * 1日15〜30いいね（1回5〜10件 × 3回）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { searchX } = require('../../lib/grok-client');
const { likeTweet } = require('../../lib/x-api');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TARGET_FILE = path.join(DATA_DIR, 'target_accounts.json');
const LIKE_HISTORY_FILE = path.join(DATA_DIR, 'like_history.json');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'like-worker.log');

const LIKES_PER_RUN = 8;          // 1回あたりのいいね数
const MAX_LIKES_PER_ACCOUNT = 3;  // 同一アカウントへの1日上限
const LIKE_INTERVAL_MS = 30000;   // いいね間隔: 30秒
const MAX_CONSECUTIVE_ERRORS = 3; // 連続エラー上限

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
 * 今日のいいね数を集計（アカウント別）
 */
function getTodayLikeCounts(history) {
  const today = new Date().toISOString().split('T')[0];
  const counts = {};
  for (const like of history) {
    if (like.liked_at && like.liked_at.startsWith(today)) {
      const key = like.target_username?.toLowerCase() || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

/**
 * 既にいいね済みのツイートIDを取得
 */
function getLikedTweetIds(history) {
  return new Set(history.map(l => l.tweet_id));
}

/**
 * Grok x_search でターゲットの最新投稿を複数取得
 */
async function findRecentTweets(accounts) {
  const usernames = accounts.map(a => a.username.replace('@', '')).slice(0, 5);
  const prompt =
    `以下のXアカウントの直近12時間の投稿を探してください: ${usernames.map(u => `@${u}`).join(', ')}。` +
    `投資・株・マーケットに関する投稿を優先してください。` +
    `各投稿のツイートURLを必ず含めてください。`;

  try {
    const text = await searchX(prompt, 12);
    const tweetPattern = /https?:\/\/(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/g;
    const tweets = [];
    let match;
    while ((match = tweetPattern.exec(text)) !== null) {
      tweets.push({
        username: `@${match[1]}`,
        tweet_id: match[2],
        url: match[0],
      });
    }
    return tweets;
  } catch (err) {
    log(`検索エラー: ${err.message}`);
    return [];
  }
}

/**
 * 投資キーワード系のバズツイートも追加検索
 */
async function findBuzzTweets() {
  const prompt =
    `直近6時間で日本語の投資・株に関するツイートで、いいね数がまだ少ない（10〜50いいね程度）` +
    `だけど面白い・有益な投稿を5件探してください。各ツイートのURLを含めてください。`;

  try {
    const text = await searchX(prompt, 6);
    const tweetPattern = /https?:\/\/(?:x\.com|twitter\.com)\/(\w+)\/status\/(\d+)/g;
    const tweets = [];
    let match;
    while ((match = tweetPattern.exec(text)) !== null) {
      tweets.push({
        username: `@${match[1]}`,
        tweet_id: match[2],
        url: match[0],
        source: 'buzz',
      });
    }
    return tweets;
  } catch (err) {
    log(`バズ検索エラー: ${err.message}`);
    return [];
  }
}

/**
 * メイン実行
 */
async function run(count) {
  const likeCount = count || LIKES_PER_RUN;
  log(`=== like-worker 開始（${likeCount}件予定）===`);

  // X API FreeプランではいいねAPIが使えない
  // Basicプラン($100/月)以上が必要
  log('⚠️ X API Freeプランではいいね機能は利用不可。スキップします。');
  log('Basicプラン($100/月)にアップグレードすると有効化できます。');
  return [];

  // KILL_SWITCH確認
  const killFile = path.join(DATA_DIR, 'KILL_SWITCH');
  if (fs.existsSync(killFile)) {
    log('KILL_SWITCH有効 → 停止');
    return [];
  }

  // ターゲットアカウント読み込み
  const targets = loadJson(TARGET_FILE, []);
  const history = loadJson(LIKE_HISTORY_FILE, []);
  const todayCounts = getTodayLikeCounts(history);
  const likedIds = getLikedTweetIds(history);

  // ターゲットの最新投稿 + バズツイートを並行取得
  log('ツイート検索中...');
  const [targetTweets, buzzTweets] = await Promise.all([
    targets.length > 0 ? findRecentTweets(targets) : Promise.resolve([]),
    findBuzzTweets(),
  ]);

  // 結合してフィルタリング
  const allTweets = [...targetTweets, ...buzzTweets].filter(t => {
    // 既にいいね済みを除外
    if (likedIds.has(t.tweet_id)) return false;
    // 同一アカウントの1日上限チェック
    const key = t.username.toLowerCase();
    if ((todayCounts[key] || 0) >= MAX_LIKES_PER_ACCOUNT) return false;
    // 自分を除外
    if (key === '@kaizokuokabu') return false;
    return true;
  });

  // 重複除去
  const unique = [];
  const seenIds = new Set();
  for (const t of allTweets) {
    if (!seenIds.has(t.tweet_id)) {
      seenIds.add(t.tweet_id);
      unique.push(t);
    }
  }

  log(`いいね候補: ${unique.length}件（ターゲット${targetTweets.length} + バズ${buzzTweets.length}）`);

  const results = [];
  let consecutiveErrors = 0;

  for (const tweet of unique.slice(0, likeCount + 3)) {
    if (results.length >= likeCount) break;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      log(`連続エラー${MAX_CONSECUTIVE_ERRORS}回 → 停止`);
      break;
    }

    log(`いいね実行: ${tweet.username} / ${tweet.tweet_id}`);
    const success = await likeTweet(tweet.tweet_id);

    if (success) {
      const record = {
        target_username: tweet.username,
        tweet_id: tweet.tweet_id,
        source: tweet.source || 'target',
        liked_at: new Date().toISOString(),
      };
      results.push(record);
      history.unshift(record);
      todayCounts[tweet.username.toLowerCase()] = (todayCounts[tweet.username.toLowerCase()] || 0) + 1;
      consecutiveErrors = 0;
      log(`  → ✅ いいね成功`);
    } else {
      consecutiveErrors++;
      log(`  → ❌ いいね失敗（連続${consecutiveErrors}回目）`);
    }

    // 間隔を空ける
    await new Promise(r => setTimeout(r, LIKE_INTERVAL_MS));
  }

  // 履歴保存（最大1000件）
  saveJson(LIKE_HISTORY_FILE, history.slice(0, 1000));

  log(`=== like-worker 完了: ${results.length}件いいね ===`);
  return results;
}

if (require.main === module) {
  const count = parseInt(process.argv[2]) || LIKES_PER_RUN;
  run(count).then(results => {
    console.log(`\n✅ ${results.length}件のいいねを実行しました`);
  }).catch(err => {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { run };
