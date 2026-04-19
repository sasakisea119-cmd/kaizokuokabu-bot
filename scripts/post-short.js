/**
 * 短文ツイートBot
 * - Haikuで20〜60字級のさらっと読めるツイートを1〜N件生成
 * - 重複ガードを通してから投稿
 * - 1日複数回呼ばれることを想定（朝・昼・夜の合間に挟む）
 *
 * 使い方:
 *   node scripts/post-short.js                   # 1件投稿
 *   node scripts/post-short.js --dry-run         # 生成のみ
 *   node scripts/post-short.js --max 3           # 最大3件投稿（90秒以上空ける）
 *   node scripts/post-short.js --style toikake   # 問いかけ型固定
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { postTweet } = require('../lib/x-api');
const { generateShortTweet, STYLES } = require('../lib/short-generator');
const { findDuplicate } = require('../lib/dedup');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'post_history.json');
const RESEARCH_PATH = path.join(__dirname, '..', 'data', 'research_pool.json');
const MIN_DELAY_MS = 90 * 1000;
const DAILY_LIMIT = 3; // 短文1日3件まで

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
      else { args[key] = true; }
    }
  }
  return args;
}

function buildContext(researchPool) {
  // research_pool から最新の3件をコンテキストに
  const recent = (researchPool || [])
    .filter(r => r.title)
    .slice(-3)
    .map(r => `- ${r.title}: ${(r.summary || '').slice(0, 60)}`)
    .join('\n');
  return recent || '';
}

function todayShortPostsCount(history) {
  const today = new Date().toISOString().slice(0, 10);
  return history.filter(h => h.tweet_type === 'short_personal' && (h.posted_at || '').startsWith(today)).length;
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = args['dry-run'] === true;
  const maxPosts = parseInt(args.max || '1', 10);
  const style = args.style || 'auto';

  console.log(`\n💬 短文ツイートBot 起動`);
  console.log(`  モード: ${dryRun ? 'DRY RUN' : '本番'}`);
  console.log(`  最大件数: ${maxPosts}`);
  console.log(`  スタイル: ${style}${style === 'auto' ? ` (${Object.keys(STYLES).join('/')})` : ''}`);

  const history = readJSON(HISTORY_PATH, []);
  const researchPool = readJSON(RESEARCH_PATH, []);

  const todayCount = todayShortPostsCount(history);
  console.log(`\n📊 今日の短文実績: ${todayCount}/${DAILY_LIMIT}`);
  if (todayCount >= DAILY_LIMIT && !dryRun) {
    console.log(`  日次上限達成。本日はスキップ`);
    return;
  }

  const context = buildContext(researchPool);
  const remaining = Math.min(maxPosts, DAILY_LIMIT - todayCount);
  let postedCount = 0;

  for (let i = 0; i < remaining; i++) {
    console.log(`\n[${i + 1}/${remaining}] 生成中...`);
    let result = null;
    for (let retry = 0; retry < 3; retry++) {
      const candidate = await generateShortTweet({ style, context });
      if (!candidate) continue;
      const dup = findDuplicate(candidate.text, history, { hours: 72 });
      if (dup.isDuplicate) {
        console.warn(`  ⚠️ 重複検出 (${dup.reason}) → 再生成`);
        continue;
      }
      result = candidate;
      break;
    }
    if (!result) {
      console.warn(`  ⏭️  生成失敗。次へ`);
      continue;
    }

    console.log(`  [${result.label}] ${result.text} (${result.text.length}字)`);

    if (dryRun) {
      postedCount++;
      continue;
    }

    const posted = await postTweet(result.text);
    if (posted && posted.id) {
      console.log(`  ✅ 投稿成功: https://x.com/kaizokuokabu/status/${posted.id}`);
      history.push({
        tweet_id: posted.id,
        text: result.text,
        tweet_type: 'short_personal',
        theme: `short_${result.style}`,
        posted_at: new Date().toISOString(),
        metrics: null,
        fetched_at: null,
      });
      writeJSON(HISTORY_PATH, history);
      postedCount++;
      if (i < remaining - 1) {
        console.log(`  ⏳ ${MIN_DELAY_MS / 1000}秒待機...`);
        await sleep(MIN_DELAY_MS);
      }
    } else {
      console.error(`  ❌ 投稿失敗`);
    }
  }

  console.log(`\n🎉 完了: ${postedCount}件${dryRun ? '（DRY RUN）' : '投稿'}`);
}

main().catch(err => {
  console.error('❌ 致命的エラー:', err.message);
  console.error(err.stack);
  process.exit(1);
});
