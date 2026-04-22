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
const { postTweet, uploadMedia, postTweetWithMedia } = require('../lib/x-api');
const { buildStockCard, buildComparisonCard, renderSvgToBase64 } = require('../lib/card-gen');
const { findDuplicate } = require('../lib/dedup');
const { logAndGuardFreshness } = require('../lib/freshness');

const QUEUE_PATH = path.join(__dirname, '..', 'data', 'queue.json');
const HISTORY_PATH = path.join(__dirname, '..', 'data', 'post_history.json');
// 機械臭を消すため90分±20分のランダム間隔（X側のスパム検知対策）
const INTERVAL_BASE_MS = 90 * 60 * 1000;
const INTERVAL_JITTER_MS = 20 * 60 * 1000;
function nextIntervalMs() {
  const jitter = (Math.random() * 2 - 1) * INTERVAL_JITTER_MS; // -20〜+20分
  return Math.max(60 * 60 * 1000, INTERVAL_BASE_MS + jitter); // 最低60分は確保
}

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
  let pending = ctaTweets.filter(t => !postedIds.has(t.id));

  // scheduled_at 対応：未来予約のものは除外
  const nowIso = new Date().toISOString();
  const scheduled = pending.filter(t => t.scheduled_at);
  const unscheduled = pending.filter(t => !t.scheduled_at);
  const dueScheduled = scheduled.filter(t => t.scheduled_at <= nowIso);
  // 期日到来したscheduled → unscheduled の順で投稿
  pending = [...dueScheduled, ...unscheduled];

  const futureCount = scheduled.length - dueScheduled.length;
  if (futureCount > 0) {
    console.log(`  ⏳ 未来予約: ${futureCount}本（投稿対象外）`);
    const next = scheduled.filter(t => t.scheduled_at > nowIso).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
    if (next) console.log(`     次回予約: ${next.scheduled_at} (${next.id})`);
  }

  const toPost = pending.slice(0, count);

  console.log(`\n📢 CTA投稿バッチ開始`);
  console.log(`  待機中: ${pending.length}本`);
  console.log(`  今回投稿: ${toPost.length}本`);
  console.log(`  間隔: ${INTERVAL_BASE_MS / 60000}分±${INTERVAL_JITTER_MS / 60000}分（ランダム）\n`);

  for (let i = 0; i < toPost.length; i++) {
    const tweet = toPost[i];
    console.log(`[${i + 1}/${toPost.length}] 投稿中: ${tweet.id}`);
    console.log(`  テーマ: ${tweet.theme}`);
    console.log(`  本文: ${tweet.text.substring(0, 60)}...`);

    // 重複防止ガード（直近48hの類似投稿チェック）
    const dup = findDuplicate(tweet.text, history, { hours: 48 });
    if (dup.isDuplicate) {
      console.warn(`  ⚠️ 重複検出 → 投稿スキップ (${dup.reason})`);
      // queueには残す（手動レビュー待ち）
      continue;
    }

    // 鮮度ガード
    const guard = logAndGuardFreshness('cta-batch', tweet.text, history);
    if (guard.blocked) {
      console.warn(`  鮮度リスクで投稿スキップ（queueには残す）`);
      continue;
    }

    try {
      // 画像カード生成（tweet.imageCard があれば添付）
      let mediaIds = null;
      if (tweet.imageCard) {
        try {
          console.log(`  🖼️  画像カード生成 (${tweet.imageCard.type || 'stock'})`);
          const svg = tweet.imageCard.type === 'comparison'
            ? buildComparisonCard(tweet.imageCard)
            : buildStockCard(tweet.imageCard);
          const base64 = renderSvgToBase64(svg);
          const mediaResult = await uploadMedia(base64);
          if (mediaResult && mediaResult.media_id_string) {
            mediaIds = [mediaResult.media_id_string];
          }
        } catch (err) {
          console.warn(`  ⚠️ 画像失敗、テキストのみで続行: ${err.message}`);
        }
      }

      const result = mediaIds
        ? await postTweetWithMedia(tweet.text, mediaIds)
        : await postTweet(tweet.text);
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
      const waitMs = nextIntervalMs();
      console.log(`  ⏳ ${Math.round(waitMs / 60000)}分待機（ランダム）...\n`);
      await sleep(waitMs);
    }
  }

  console.log(`\n✅ バッチ完了。${toPost.length}本投稿。`);
}

main().catch(console.error);
