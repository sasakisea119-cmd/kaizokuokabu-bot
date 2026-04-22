/**
 * インスパイアBot
 * - intercept-targets-cache.json の30アカウントの最近24h投稿から、いいね多い投稿をネタ化
 * - 元投稿のネタを借りて自分の独立ツイートを生成して投稿
 * - 1日2件まで、同一アカウントから1日1件
 *
 * 使い方:
 *   node scripts/inspire-bot.js                # 1サイクル実行
 *   node scripts/inspire-bot.js --dry-run      # 生成のみ
 *   node scripts/inspire-bot.js --max 2        # 最大2件投稿
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { getUserTimeline } = require('../lib/x-api-read');
const { postTweet } = require('../lib/x-api');
const { generateInspiredTweet } = require('../lib/inspire-generator');
const { findDuplicate } = require('../lib/dedup');
const { logAndGuardFreshness } = require('../lib/freshness');

const TARGETS_CACHE = path.join(__dirname, '..', 'data', 'intercept-targets-cache.json');
const STATE_PATH = path.join(__dirname, '..', 'data', 'inspire-state.json');
const LOG_PATH = path.join(__dirname, '..', 'data', 'inspire-log.json');
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'post_history.json');

const DAILY_LIMIT = 2;
const PER_ACCOUNT_DAILY = 1;
const MIN_DELAY_MS = 120 * 1000; // 2分間隔
const MAX_AGE_MIN = 24 * 60;
const MIN_AGE_MIN = 30;
const MIN_LIKES = 30;            // 元投稿の最低いいね数

function readJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

function todayStats(log) {
  const today = new Date().toISOString().slice(0, 10);
  const todayLog = log.filter(e => e.posted_at && e.posted_at.startsWith(today) && !e.dry_run);
  const byAccount = {};
  for (const e of todayLog) {
    byAccount[e.source_username] = (byAccount[e.source_username] || 0) + 1;
  }
  return { total: todayLog.length, byAccount };
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = args['dry-run'] === true;
  const maxPosts = parseInt(args.max || String(DAILY_LIMIT), 10);

  console.log(`\n🎨 インスパイアBot 起動`);
  console.log(`  モード: ${dryRun ? 'DRY RUN' : '本番'}`);
  console.log(`  最大件数: ${maxPosts}`);

  if (!fs.existsSync(TARGETS_CACHE)) {
    console.error(`❌ ターゲットキャッシュなし。intercept-bot --resolve-ids を先に実行`);
    process.exit(1);
  }

  const cache = readJSON(TARGETS_CACHE, { users: {} });
  const state = readJSON(STATE_PATH, { since_ids: {}, used_source_ids: [] });
  const log = readJSON(LOG_PATH, []);
  const history = readJSON(HISTORY_PATH, []);
  const usedIds = new Set(state.used_source_ids || []);

  const stats = todayStats(log);
  console.log(`\n📊 今日の実績: ${stats.total}/${DAILY_LIMIT}`);
  if (stats.total >= DAILY_LIMIT && !dryRun) {
    console.log(`  日次上限達成。本日はスキップ`);
    return;
  }

  // === タイムライン取得 & 候補収集 ===
  const candidates = [];
  const now = Date.now();

  console.log(`\n📥 ${Object.keys(cache.users).length}アカウントから候補抽出中...`);

  for (const [username, info] of Object.entries(cache.users)) {
    if (!info.id) continue;
    try {
      const tweets = await getUserTimeline(info.id, {
        max_results: 5,
        since_id: state.since_ids[username],
      });
      if (!tweets) continue;

      for (const t of tweets) {
        if (usedIds.has(t.id)) continue;
        const ageMin = (now - new Date(t.created_at).getTime()) / 60000;
        if (ageMin < MIN_AGE_MIN || ageMin > MAX_AGE_MIN) continue;
        const likes = (t.public_metrics || {}).like_count || 0;
        if (likes < MIN_LIKES) continue;
        // テキストが短すぎる/画像のみは除外
        if ((t.text || '').replace(/https?:\S+/g, '').trim().length < 20) continue;

        candidates.push({
          username,
          tweet_id: t.id,
          text: t.text,
          age_min: ageMin,
          likes,
          metrics: t.public_metrics || {},
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

  if (!dryRun) writeJSON(STATE_PATH, state);

  console.log(`\n🎯 ネタ候補: ${candidates.length}件 (いいね${MIN_LIKES}+ / ${MIN_AGE_MIN}〜${MAX_AGE_MIN}分前)`);
  if (candidates.length === 0) {
    console.log(`  候補なし。次回実行へ`);
    return;
  }

  // エンゲージ高い順
  candidates.sort((a, b) => {
    const sa = a.likes + (a.metrics.reply_count || 0) * 3;
    const sb = b.likes + (b.metrics.reply_count || 0) * 3;
    return sb - sa;
  });

  const remaining = Math.min(maxPosts, DAILY_LIMIT - stats.total);
  let postedCount = 0;

  for (const c of candidates) {
    if (postedCount >= remaining) break;
    if ((stats.byAccount[c.username] || 0) >= PER_ACCOUNT_DAILY) continue;

    console.log(`\n--- [${postedCount + 1}/${remaining}] @${c.username} (❤️${c.likes}, ${Math.round(c.age_min)}分前) ---`);
    console.log(`  元: ${c.text.slice(0, 80).replace(/\n/g, ' ')}...`);

    const result = await generateInspiredTweet({
      sourceText: c.text,
      sourceAuthor: c.username,
    });
    if (!result) {
      console.log(`  ⏭️  生成失敗 → 次へ`);
      continue;
    }
    console.log(`  💡 [angle=${result.angle}] ${result.text.slice(0, 60)}...`);

    const dup = findDuplicate(result.text, history, { hours: 72 });
    if (dup.isDuplicate) {
      console.warn(`  ⚠️ 自分の過去投稿と重複 (${dup.reason}) → 次へ`);
      continue;
    }

    // 鮮度ガード
    const guard = logAndGuardFreshness('inspire-bot', result.text, history);
    if (guard.blocked) {
      console.warn(`  鮮度リスクで投稿スキップ → 次候補へ`);
      continue;
    }

    if (dryRun) {
      log.push({
        source_username: c.username,
        source_tweet_id: c.tweet_id,
        angle: result.angle,
        text: result.text,
        dry_run: true,
        posted_at: new Date().toISOString(),
      });
      postedCount++;
      continue;
    }

    const posted = await postTweet(result.text);
    if (posted && posted.id) {
      console.log(`  ✅ 投稿成功: https://x.com/kaizokuokabu/status/${posted.id}`);
      usedIds.add(c.tweet_id);
      state.used_source_ids = Array.from(usedIds).slice(-300);

      log.push({
        source_username: c.username,
        source_tweet_id: c.tweet_id,
        source_text: c.text.slice(0, 200),
        angle: result.angle,
        text: result.text,
        tweet_id: posted.id,
        posted_at: new Date().toISOString(),
      });
      history.push({
        tweet_id: posted.id,
        text: result.text,
        tweet_type: 'inspire',
        theme: `inspire_${c.username}`,
        posted_at: new Date().toISOString(),
        metrics: null,
        fetched_at: null,
      });
      writeJSON(LOG_PATH, log);
      writeJSON(STATE_PATH, state);
      writeJSON(HISTORY_PATH, history);

      stats.byAccount[c.username] = (stats.byAccount[c.username] || 0) + 1;
      postedCount++;
      if (postedCount < remaining) await sleep(MIN_DELAY_MS);
    } else {
      console.error(`  ❌ 投稿失敗`);
    }
  }

  writeJSON(LOG_PATH, log);
  if (!dryRun) writeJSON(STATE_PATH, state);
  console.log(`\n🎉 完了: ${postedCount}件${dryRun ? '（DRY RUN）' : '投稿'}`);
}

main().catch(err => {
  console.error('❌ 致命的エラー:', err.message);
  console.error(err.stack);
  process.exit(1);
});
