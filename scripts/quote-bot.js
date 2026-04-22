/**
 * 引用RTBot
 * - intercept-targets-cache.json の30アカウントのタイムラインを取得
 * - 最近5分〜24時間以内かつ いいね10+ の投稿を候補に
 * - Haikuで独自コメントを生成 → quoteTweet で投稿
 * - 1日5件まで、同一アカウント1日1件
 *
 * 使い方:
 *   node scripts/quote-bot.js                # 1サイクル実行
 *   node scripts/quote-bot.js --dry-run      # コメント生成のみ
 *   node scripts/quote-bot.js --max 3        # 最大3件
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { getUserTimeline } = require('../lib/x-api-read');
const { quoteTweet, likeTweet } = require('../lib/x-api');
const { generateQuoteComment } = require('../lib/quote-generator');
const { logAndGuardFreshness } = require('../lib/freshness');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'post_history.json');

// --- パス定義 ---
const TARGETS_CACHE = path.join(__dirname, '..', 'data', 'intercept-targets-cache.json');
const STATE_PATH = path.join(__dirname, '..', 'data', 'quote-state.json');
const LOG_PATH = path.join(__dirname, '..', 'data', 'quote-log.json');

// --- 設定 ---
const DAILY_QUOTE_LIMIT = 1;       // 1日の引用RT上限（API枠温存のため1件）
const PER_ACCOUNT_DAILY_LIMIT = 1; // 同一アカウントへの1日引用上限
const MIN_DELAY_MS = 90 * 1000;    // 引用間の最小間隔（90秒）
const MAX_QUOTE_AGE_MIN = 24 * 60; // 投稿から24時間以内をターゲット
const MIN_QUOTE_AGE_MIN = 5;       // 投稿から最低5分経過してから引用
const MIN_LIKES = 30;              // 候補の最低いいね数（質を上げるため引き上げ）

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

/**
 * 今日の引用統計
 */
function computeTodayStats(log) {
  const today = new Date().toISOString().slice(0, 10);
  const todayLog = log.filter(e => e.quoted_at && e.quoted_at.startsWith(today) && !e.dry_run);
  const byAccount = {};
  for (const e of todayLog) {
    byAccount[e.target_username] = (byAccount[e.target_username] || 0) + 1;
  }
  return { total: todayLog.length, byAccount };
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = args['dry-run'] === true;
  const maxQuotes = parseInt(args.max || String(DAILY_QUOTE_LIMIT), 10);

  console.log(`\n💬 引用RTBot 起動`);
  console.log(`  モード: ${dryRun ? 'DRY RUN' : '本番'}`);
  console.log(`  最大引用数: ${maxQuotes}`);

  if (!fs.existsSync(TARGETS_CACHE)) {
    console.error(`❌ ターゲットキャッシュなし。先に intercept-bot --resolve-ids を実行してください`);
    process.exit(1);
  }

  const cache = readJSON(TARGETS_CACHE, { users: {} });
  const state = readJSON(STATE_PATH, { since_ids: {} });
  const log = readJSON(LOG_PATH, []);

  const stats = computeTodayStats(log);
  console.log(`\n📊 今日の引用実績: ${stats.total}/${DAILY_QUOTE_LIMIT}`);

  if (stats.total >= DAILY_QUOTE_LIMIT) {
    console.log(`  日次上限達成。本日はスキップ`);
    return;
  }

  // --- タイムライン取得 & 候補収集 ---
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
        const ageMin = (now - new Date(t.created_at).getTime()) / 60000;
        if (ageMin < MIN_QUOTE_AGE_MIN || ageMin > MAX_QUOTE_AGE_MIN) continue;
        const likeCount = (t.public_metrics || {}).like_count || 0;
        if (likeCount < MIN_LIKES) continue;

        candidates.push({
          username,
          user_id: info.id,
          tweet_id: t.id,
          text: t.text,
          created_at: t.created_at,
          age_min: ageMin,
          metrics: t.public_metrics || {}
        });
      }

      // since_id更新（本番のみ）
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

  console.log(`\n🎯 引用候補: ${candidates.length}件 (いいね${MIN_LIKES}+ / ${MIN_QUOTE_AGE_MIN}分〜${MAX_QUOTE_AGE_MIN}分前)`);
  if (candidates.length === 0) {
    console.log(`  候補なし。次回実行へ`);
    return;
  }

  // エンゲージ高い順（いいね + リプ×3 + RT×2）
  candidates.sort((a, b) => {
    const sa = (a.metrics.like_count || 0) + (a.metrics.reply_count || 0) * 3 + (a.metrics.retweet_count || 0) * 2;
    const sb = (b.metrics.like_count || 0) + (b.metrics.reply_count || 0) * 3 + (b.metrics.retweet_count || 0) * 2;
    return sb - sa;
  });

  // --- 引用実行 ---
  const remainingBudget = Math.min(maxQuotes, DAILY_QUOTE_LIMIT - stats.total);
  let postedCount = 0;

  for (const c of candidates) {
    if (postedCount >= remainingBudget) break;
    if ((stats.byAccount[c.username] || 0) >= PER_ACCOUNT_DAILY_LIMIT) continue;

    console.log(`\n--- [${postedCount + 1}/${remainingBudget}] @${c.username} (${Math.round(c.age_min)}分前, ❤️${c.metrics.like_count || 0}) ---`);
    console.log(`  元: ${c.text.slice(0, 80)}...`);

    const comment = await generateQuoteComment({
      sourceTweet: c.text,
      sourceAuthor: c.username
    });

    if (!comment) {
      console.log(`  ⏭️  SKIP判定`);
      continue;
    }

    console.log(`  コメント案: ${comment}`);

    // 鮮度ガード（社長方針：1日前までのデータ基準）
    const history = readJSON(HISTORY_PATH, []);
    const guard = logAndGuardFreshness('quote-bot', comment, history);
    if (guard.blocked) {
      console.warn(`  鮮度リスクで投稿スキップ → 次候補へ`);
      continue;
    }

    if (dryRun) {
      log.push({
        target_username: c.username,
        target_tweet_id: c.tweet_id,
        comment,
        dry_run: true,
        quoted_at: new Date().toISOString()
      });
      postedCount++;
      continue;
    }

    const result = await quoteTweet(comment, c.tweet_id);
    if (result && result.id) {
      console.log(`  ✅ 引用RT成功: https://x.com/kaizokuokabu/status/${result.id}`);

      // 元ツイートにもいいね（好感シグナル）
      await likeTweet(c.tweet_id);

      log.push({
        target_username: c.username,
        target_tweet_id: c.tweet_id,
        target_text: c.text.slice(0, 200),
        comment,
        quote_tweet_id: result.id,
        quoted_at: new Date().toISOString()
      });

      stats.byAccount[c.username] = (stats.byAccount[c.username] || 0) + 1;
      postedCount++;

      writeJSON(LOG_PATH, log);
      await sleep(MIN_DELAY_MS);
    } else {
      console.error(`  ❌ 引用RT失敗`);
    }
  }

  writeJSON(LOG_PATH, log);
  console.log(`\n🎉 サイクル完了: ${postedCount}件引用${dryRun ? '（DRY RUN）' : '投稿'}`);
}

main().catch(err => {
  console.error('❌ 致命的エラー:', err.message);
  console.error(err.stack);
  process.exit(1);
});
