/**
 * いいね配布Bot
 * - intercept-targets-cache.json の30アカウントのタイムラインを取得
 * - 最近5分〜12時間以内の投稿にいいねを付ける（好感シグナル配布）
 * - 1日30件まで、同一アカウント1日2件
 *
 * 使い方:
 *   node scripts/like-bot.js                # 1サイクル実行
 *   node scripts/like-bot.js --dry-run      # いいね対象を表示のみ
 *   node scripts/like-bot.js --max 10       # 最大10件
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { getUserTimeline } = require('../lib/x-api-read');
const { likeTweet } = require('../lib/x-api');

const TARGETS_CACHE = path.join(__dirname, '..', 'data', 'intercept-targets-cache.json');
const STATE_PATH = path.join(__dirname, '..', 'data', 'like-state.json');
const LOG_PATH = path.join(__dirname, '..', 'data', 'like-log.json');

const DAILY_LIKE_LIMIT = 30;
const PER_ACCOUNT_DAILY_LIMIT = 2;
const MIN_DELAY_MS = 15 * 1000;        // いいね間の最小間隔（15秒、自然な振る舞い）
const MAX_LIKE_AGE_MIN = 12 * 60;      // 投稿から12時間以内
const MIN_LIKE_AGE_MIN = 5;            // 5分以降（リアルタイム通知避ける）
const MIN_SOURCE_LIKES = 1;            // スパム除外用

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

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next; i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function computeTodayStats(log) {
  const today = new Date().toISOString().slice(0, 10);
  const todayLog = log.filter(e => e.liked_at && e.liked_at.startsWith(today) && !e.dry_run);
  const byAccount = {};
  for (const e of todayLog) {
    byAccount[e.target_username] = (byAccount[e.target_username] || 0) + 1;
  }
  return { total: todayLog.length, byAccount };
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = args['dry-run'] === true;
  const maxLikes = parseInt(args.max || String(DAILY_LIKE_LIMIT), 10);

  console.log(`\n❤️  いいね配布Bot 起動`);
  console.log(`  モード: ${dryRun ? 'DRY RUN' : '本番'}`);
  console.log(`  最大いいね数: ${maxLikes}`);

  if (!fs.existsSync(TARGETS_CACHE)) {
    console.error(`❌ ターゲットキャッシュなし。intercept-bot --resolve-ids を先に実行`);
    process.exit(1);
  }

  const cache = readJSON(TARGETS_CACHE, { users: {} });
  const state = readJSON(STATE_PATH, { since_ids: {}, liked_tweet_ids: [] });
  const log = readJSON(LOG_PATH, []);

  const stats = computeTodayStats(log);
  console.log(`\n📊 今日のいいね実績: ${stats.total}/${DAILY_LIKE_LIMIT}`);

  if (stats.total >= DAILY_LIKE_LIMIT) {
    console.log(`  日次上限達成。本日はスキップ`);
    return;
  }

  // 既にいいね済みIDセット（重複防止）
  const likedIds = new Set(state.liked_tweet_ids || []);

  const candidates = [];
  const now = Date.now();

  console.log(`\n📥 ${Object.keys(cache.users).length}アカウントのタイムライン取得中...`);

  for (const [username, info] of Object.entries(cache.users)) {
    if (!info.id) continue;
    try {
      const tweets = await getUserTimeline(info.id, {
        max_results: 5,
        since_id: state.since_ids[username]
      });

      for (const t of tweets) {
        if (likedIds.has(t.id)) continue;
        const ageMin = (now - new Date(t.created_at).getTime()) / 60000;
        if (ageMin < MIN_LIKE_AGE_MIN || ageMin > MAX_LIKE_AGE_MIN) continue;
        const likeCount = (t.public_metrics || {}).like_count || 0;
        if (likeCount < MIN_SOURCE_LIKES) continue;

        candidates.push({
          username,
          tweet_id: t.id,
          text: t.text,
          age_min: ageMin,
          metrics: t.public_metrics || {}
        });
      }

      if (tweets.length > 0) {
        const maxId = tweets.reduce((acc, t) => (BigInt(t.id) > BigInt(acc) ? t.id : acc), tweets[0].id);
        state.since_ids[username] = maxId;
      }

      await sleep(500);
    } catch (err) {
      console.error(`  ❌ @${username}: ${err.message}`);
    }
  }

  if (!dryRun) {
    writeJSON(STATE_PATH, state);
  }

  console.log(`\n🎯 いいね候補: ${candidates.length}件 (いいね${MIN_SOURCE_LIKES}+ / ${MIN_LIKE_AGE_MIN}分〜${MAX_LIKE_AGE_MIN}分前)`);
  if (candidates.length === 0) {
    console.log(`  候補なし。次回実行へ`);
    return;
  }

  // エンゲージ高い順 + 新しい順
  candidates.sort((a, b) => {
    const sa = (a.metrics.like_count || 0) + a.age_min * -0.1;
    const sb = (b.metrics.like_count || 0) + b.age_min * -0.1;
    return sb - sa;
  });

  const remainingBudget = Math.min(maxLikes, DAILY_LIKE_LIMIT - stats.total);
  let likedCount = 0;

  for (const c of candidates) {
    if (likedCount >= remainingBudget) break;
    if ((stats.byAccount[c.username] || 0) >= PER_ACCOUNT_DAILY_LIMIT) continue;

    console.log(`\n[${likedCount + 1}/${remainingBudget}] ❤️ @${c.username} (${Math.round(c.age_min)}分前, ❤️${c.metrics.like_count || 0})`);
    console.log(`  元: ${c.text.slice(0, 60).replace(/\n/g, ' ')}...`);

    if (dryRun) {
      log.push({
        target_username: c.username,
        target_tweet_id: c.tweet_id,
        dry_run: true,
        liked_at: new Date().toISOString()
      });
      likedCount++;
      continue;
    }

    const success = await likeTweet(c.tweet_id);
    if (success) {
      console.log(`  ✅ いいね成功`);
      likedIds.add(c.tweet_id);
      state.liked_tweet_ids = Array.from(likedIds).slice(-500); // 直近500件だけ保持

      log.push({
        target_username: c.username,
        target_tweet_id: c.tweet_id,
        liked_at: new Date().toISOString()
      });

      stats.byAccount[c.username] = (stats.byAccount[c.username] || 0) + 1;
      likedCount++;

      writeJSON(LOG_PATH, log);
      writeJSON(STATE_PATH, state);
      await sleep(MIN_DELAY_MS);
    } else {
      console.error(`  ❌ いいね失敗`);
    }
  }

  writeJSON(LOG_PATH, log);
  if (!dryRun) writeJSON(STATE_PATH, state);
  console.log(`\n🎉 サイクル完了: ${likedCount}件いいね${dryRun ? '（DRY RUN）' : ''}`);
}

main().catch(err => {
  console.error('❌ 致命的エラー:', err.message);
  console.error(err.stack);
  process.exit(1);
});
