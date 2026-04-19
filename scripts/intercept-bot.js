/**
 * インターセプトBot
 * - 指定アカウント（config/intercept-targets.md）の最新ツイートをポーリング
 * - 3-10分の遅延で自動リプ（先頭を避け、リプ欄上位を狙う）
 * - 1日10-15リプ、同一アカウントへの連続リプは1日最大2回まで
 *
 * 使い方:
 *   node scripts/intercept-bot.js                  # 1サイクル実行
 *   node scripts/intercept-bot.js --dry-run        # リプ案生成のみ（投稿しない）
 *   node scripts/intercept-bot.js --max 3          # 最大3件までリプ
 *   node scripts/intercept-bot.js --resolve-ids    # ユーザー名→IDの初回解決
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { getUserIdByUsername, getUserTimeline } = require('../lib/x-api-read');
const { replyToTweet, likeTweet } = require('../lib/x-api');
const { generateReply } = require('../lib/reply-generator');

// --- パス定義 ---
const TARGETS_PATH = path.join(__dirname, '..', 'config', 'intercept-targets.md');
const TARGETS_CACHE = path.join(__dirname, '..', 'data', 'intercept-targets-cache.json');
const STATE_PATH = path.join(__dirname, '..', 'data', 'intercept-state.json');
const LOG_PATH = path.join(__dirname, '..', 'data', 'intercept-log.json');

// --- 設定 ---
const DAILY_REPLY_LIMIT = 12;      // 1日のリプ上限
const PER_ACCOUNT_DAILY_LIMIT = 2; // 同一アカウントへの1日リプ上限
const MIN_DELAY_MS = 60 * 1000;    // リプ間の最小間隔（60秒）
const MAX_REPLY_AGE_MIN = 120;     // ツイート投稿から何分以内をターゲットにするか
const MIN_REPLY_AGE_MIN = 3;       // 投稿から最低何分経過してからリプするか（先頭を避ける）

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
 * config/intercept-targets.md から @username を抽出
 */
function extractTargetUsernames() {
  const md = fs.readFileSync(TARGETS_PATH, 'utf-8');
  const matches = md.matchAll(/^- @([\w\d_]+)/gm);
  return [...new Set([...matches].map(m => m[1]))];
}

/**
 * ユーザー名→IDの対応表（キャッシュ）
 */
async function resolveTargetIds({ force = false } = {}) {
  const usernames = extractTargetUsernames();
  const cache = readJSON(TARGETS_CACHE, { users: {} });

  for (const name of usernames) {
    if (!force && cache.users[name]) continue;
    console.log(`  解決中: @${name}`);
    const info = await getUserIdByUsername(name);
    if (info) {
      cache.users[name] = { id: info.id, resolved_at: new Date().toISOString() };
    } else {
      cache.users[name] = { id: null, error: 'not_found', resolved_at: new Date().toISOString() };
    }
    await sleep(1200); // レートリミット対策
  }

  cache.updated_at = new Date().toISOString();
  writeJSON(TARGETS_CACHE, cache);
  return cache;
}

/**
 * 今日のリプ統計を算出
 */
function computeTodayStats(log) {
  const today = new Date().toISOString().slice(0, 10);
  // dry-run は実績に含めない
  const todayLog = log.filter(e => e.replied_at && e.replied_at.startsWith(today) && !e.dry_run);

  const byAccount = {};
  for (const e of todayLog) {
    byAccount[e.target_username] = (byAccount[e.target_username] || 0) + 1;
  }
  return { total: todayLog.length, byAccount };
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = args['dry-run'] === true;
  const maxReplies = parseInt(args.max || String(DAILY_REPLY_LIMIT), 10);

  console.log(`\n🎯 インターセプトBot 起動`);
  console.log(`  モード: ${dryRun ? 'DRY RUN' : '本番'}`);
  console.log(`  最大リプ数: ${maxReplies}`);

  // --- ID解決 ---
  if (args['resolve-ids'] === true) {
    console.log(`\n🔍 対象ユーザーIDを解決中...`);
    await resolveTargetIds({ force: true });
    console.log(`✅ ID解決完了: ${TARGETS_CACHE}`);
    return;
  }

  // キャッシュがなければ初回解決
  if (!fs.existsSync(TARGETS_CACHE)) {
    console.log(`\n⚠️  ID キャッシュなし。初回解決を実行...`);
    await resolveTargetIds();
  }

  const cache = readJSON(TARGETS_CACHE, { users: {} });
  const state = readJSON(STATE_PATH, { since_ids: {} });
  const log = readJSON(LOG_PATH, []);

  const stats = computeTodayStats(log);
  console.log(`\n📊 今日のリプ実績: ${stats.total}/${DAILY_REPLY_LIMIT}`);

  if (stats.total >= DAILY_REPLY_LIMIT) {
    console.log(`⛔ 1日のリプ上限に達しています`);
    return;
  }

  // --- タイムライン取得 ---
  const usernames = extractTargetUsernames();
  const candidates = [];

  console.log(`\n📥 ${usernames.length}アカウントのタイムライン取得中...`);

  for (const username of usernames) {
    const user = cache.users[username];
    if (!user || !user.id) continue;

    // 同一アカウントへの1日リプ上限チェック
    if ((stats.byAccount[username] || 0) >= PER_ACCOUNT_DAILY_LIMIT) {
      continue;
    }

    try {
      const tweets = await getUserTimeline(user.id, {
        max_results: 5,
        since_id: state.since_ids[username]
      });

      if (!tweets) continue;

      for (const t of tweets) {
        const ageMin = (Date.now() - new Date(t.created_at).getTime()) / 60000;

        // エイジフィルタ（早すぎる・古すぎるのを除外）
        if (ageMin < MIN_REPLY_AGE_MIN) continue;
        if (ageMin > MAX_REPLY_AGE_MIN) continue;

        // 既にリプ済みかチェック
        if (log.some(e => e.target_tweet_id === t.id)) continue;

        candidates.push({
          username,
          user_id: user.id,
          tweet_id: t.id,
          text: t.text,
          created_at: t.created_at,
          age_min: ageMin,
          metrics: t.public_metrics || {}
        });
      }

      // 最新since_id更新
      if (tweets.length > 0) {
        const maxId = tweets.reduce((acc, t) => (BigInt(t.id) > BigInt(acc) ? t.id : acc), tweets[0].id);
        state.since_ids[username] = maxId;
      }

      await sleep(500); // レートリミット対策
    } catch (err) {
      console.error(`  ❌ @${username}: ${err.message}`);
    }
  }

  // dry-run時は since_ids を保存しない（次回本番実行の候補が枯れるのを防ぐ）
  if (!dryRun) {
    writeJSON(STATE_PATH, state);
  }

  console.log(`\n🎯 リプ候補: ${candidates.length}件`);
  if (candidates.length === 0) {
    console.log(`  候補なし。次回実行へ`);
    return;
  }

  // エンゲージメント高いツイートを優先
  candidates.sort((a, b) => {
    const scoreA = (a.metrics.like_count || 0) + (a.metrics.reply_count || 0) * 3;
    const scoreB = (b.metrics.like_count || 0) + (b.metrics.reply_count || 0) * 3;
    return scoreB - scoreA;
  });

  // --- リプ実行 ---
  const remainingBudget = Math.min(maxReplies, DAILY_REPLY_LIMIT - stats.total);
  let postedCount = 0;

  for (const c of candidates) {
    if (postedCount >= remainingBudget) break;
    if ((stats.byAccount[c.username] || 0) >= PER_ACCOUNT_DAILY_LIMIT) continue;

    console.log(`\n--- [${postedCount + 1}/${remainingBudget}] @${c.username} (${Math.round(c.age_min)}分前, ❤️${c.metrics.like_count || 0}) ---`);
    console.log(`  元: ${c.text.slice(0, 80)}...`);

    // リプ生成
    const replyText = await generateReply({
      sourceTweet: c.text,
      sourceAuthor: c.username
    });

    if (!replyText) {
      console.log(`  ⏭️  SKIP判定`);
      continue;
    }

    console.log(`  リプ案: ${replyText}`);

    if (dryRun) {
      log.push({
        target_username: c.username,
        target_tweet_id: c.tweet_id,
        reply_text: replyText,
        dry_run: true,
        replied_at: new Date().toISOString()
      });
      postedCount++;
      continue;
    }

    // 本番投稿
    const result = await replyToTweet(replyText, c.tweet_id);
    if (result && result.id) {
      console.log(`  ✅ 投稿成功: https://x.com/kaizokuokabu/status/${result.id}`);

      // いいねも付ける（相手への好感シグナル）
      await likeTweet(c.tweet_id);

      log.push({
        target_username: c.username,
        target_tweet_id: c.tweet_id,
        target_text: c.text.slice(0, 200),
        reply_text: replyText,
        reply_tweet_id: result.id,
        replied_at: new Date().toISOString()
      });

      stats.byAccount[c.username] = (stats.byAccount[c.username] || 0) + 1;
      postedCount++;

      writeJSON(LOG_PATH, log);
      await sleep(MIN_DELAY_MS);
    } else {
      console.error(`  ❌ 投稿失敗`);
    }
  }

  writeJSON(LOG_PATH, log);
  console.log(`\n🎉 サイクル完了: ${postedCount}件リプ${dryRun ? '（DRY RUN）' : '投稿'}`);
}

main().catch(err => {
  console.error('❌ 致命的エラー:', err.message);
  console.error(err.stack);
  process.exit(1);
});
