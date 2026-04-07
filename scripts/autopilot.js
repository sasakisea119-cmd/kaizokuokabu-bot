const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function isKillSwitchOn() {
  return fs.existsSync(path.join(DATA_DIR, 'KILL_SWITCH'));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// JST時刻で実行モードを決定
function getMode() {
  const arg = process.argv[2]; // --morning / --noon / --evening / --full
  if (arg) return arg.replace('--', '');

  const jstHour = (new Date().getUTCHours() + 9) % 24;
  if (jstHour >= 5 && jstHour < 11) return 'morning';   // 5-11時
  if (jstHour >= 11 && jstHour < 17) return 'noon';     // 11-17時
  return 'evening';                                       // 17-5時
}

async function main() {
  const mode = getMode();

  console.log('========================================');
  console.log(' kaizokuokabu 完全自動運転');
  console.log(` モード: ${mode} | ${new Date().toLocaleString('ja-JP')}`);
  console.log('========================================\n');

  if (isKillSwitchOn()) {
    const reason = fs.readFileSync(path.join(DATA_DIR, 'KILL_SWITCH'), 'utf-8');
    console.error(`[autopilot] KILL_SWITCHが有効です: ${reason}`);
    console.error('[autopilot] 解除するには: bash scripts/resume.sh');
    process.exit(1);
  }

  // 全モード共通: supervisorチェック
  console.log('\n--- Supervisor チェック ---');
  const supervisor = require('../agents/supervisor');
  const { hasCritical } = await supervisor.run();
  if (hasCritical) {
    console.error('[autopilot] CRITICALアラート検出。停止します。');
    process.exit(1);
  }

  // 月初チェック: 社員6(product-creator) + 社員7(line-builder)
  const dayOfMonth = new Date().getDate();
  if (dayOfMonth === 1 && mode === 'morning') {
    console.log('\n--- 🗓️ 月初タスク ---');
    try {
      console.log('\n--- 社員6: product-creator（月次企画書）---');
      const productCreator = require('../employees/product-creator');
      await productCreator.run();
      await sleep(10000);

      console.log('\n--- 社員7: line-builder（月次シナリオ）---');
      const lineBuilder = require('../employees/line-builder');
      await lineBuilder.run();
      await sleep(10000);
    } catch (err) {
      console.error(`[autopilot] 月次タスクエラー: ${err.message}`);
    }
  }

  // === 朝モード（7時）: フル実行 ===
  if (mode === 'morning' || mode === 'full') {
    // --- コアエージェント ---
    console.log('\n--- Fetcher: メトリクス取得 ---');
    const fetcher = require('../agents/fetcher');
    await fetcher.run();

    console.log('\n--- Analyst: パフォーマンス分析 ---');
    const analyst = require('../agents/analyst');
    await analyst.run();

    console.log('\n--- Researcher: ニュース収集（フル） ---');
    const researcher = require('../agents/researcher');
    await researcher.run();

    await sleep(90000);

    // --- 社員1: アカウント選定（毎朝） ---
    console.log('\n--- 社員1: account-selector ---');
    try {
      const accountSelector = require('../employees/account-selector');
      await accountSelector.run();
    } catch (err) {
      console.error(`[autopilot] account-selector エラー: ${err.message}`);
    }

    await sleep(10000);

    // --- 社員5: コンテンツ生成（writerの代わり） ---
    // 月500枠管理: 朝6本生成→キュー、5本投稿
    console.log('\n--- 社員5: content-poster（6本生成） ---');
    try {
      const contentPoster = require('../employees/content-poster');
      await contentPoster.run(6);
    } catch (err) {
      console.error(`[autopilot] content-poster エラー: ${err.message}`);
      console.log('\n--- Writer（フォールバック）: 投稿生成（6本） ---');
      const writer = require('../agents/writer');
      await writer.run(6);
    }

    await sleep(90000);

    console.log('\n--- Image Poster: 画像投稿（1日1回） ---');
    const imagePoster = require('../agents/image-poster');
    await imagePoster.run();

    await sleep(60000);

    // --- 社員4: 引用RT（朝1本） ---
    console.log('\n--- 社員4: quote-poster（1本） ---');
    try {
      const quotePoster = require('../employees/quote-poster');
      await quotePoster.run(1);
    } catch (err) {
      console.error(`[autopilot] quote-poster エラー: ${err.message}`);
      const retweeter = require('../agents/retweeter');
      await retweeter.run(1);
    }

    // --- 社員3: いいね（Freeプランでは自動スキップ） ---
    console.log('\n--- 社員3: like-worker ---');
    try {
      const likeWorker = require('../employees/like-worker');
      await likeWorker.run(8);
    } catch (err) {
      console.error(`[autopilot] like-worker エラー: ${err.message}`);
    }

    // --- 社員2: リプライ（朝1件） ---
    console.log('\n--- 社員2: reply-worker（1件） ---');
    try {
      const replyWorker = require('../employees/reply-worker');
      await replyWorker.run(1);
    } catch (err) {
      console.error(`[autopilot] reply-worker エラー: ${err.message}`);
    }

    // 朝: オリジナル4本投稿（20分間隔）
    console.log('\n--- Scheduler: 投稿（4本、20分間隔） ---');
    const scheduler = require('../agents/scheduler');
    await scheduler.run(4, 1200);
  }

  // === 昼モード（12時半）: 投稿＋引用RT＋交流 ===
  else if (mode === 'noon') {
    // 画像投稿フォールバック（朝に未実施なら昼に実行）
    console.log('\n--- Image Poster: 画像投稿フォールバック ---');
    try {
      const imagePoster = require('../agents/image-poster');
      await imagePoster.run();
    } catch (err) {
      console.error(`[autopilot] image-poster エラー: ${err.message}`);
    }

    await sleep(30000);

    console.log('\n--- Researcher: バズツイート候補収集 ---');
    const researcher = require('../agents/researcher');
    await researcher.runBuzzOnly();

    await sleep(60000);

    // --- 社員4: 引用RT（昼1本） ---
    console.log('\n--- 社員4: quote-poster（1本） ---');
    try {
      const quotePoster = require('../employees/quote-poster');
      await quotePoster.run(1);
    } catch (err) {
      console.error(`[autopilot] quote-poster エラー: ${err.message}`);
      const retweeter = require('../agents/retweeter');
      await retweeter.run(1);
    }

    // --- 社員3: いいね（Freeプランでは自動スキップ） ---
    console.log('\n--- 社員3: like-worker ---');
    try {
      const likeWorker = require('../employees/like-worker');
      await likeWorker.run(8);
    } catch (err) {
      console.error(`[autopilot] like-worker エラー: ${err.message}`);
    }

    // --- 社員2: リプライ（昼1件） ---
    console.log('\n--- 社員2: reply-worker（1件） ---');
    try {
      const replyWorker = require('../employees/reply-worker');
      await replyWorker.run(1);
    } catch (err) {
      console.error(`[autopilot] reply-worker エラー: ${err.message}`);
    }

    // 昼: オリジナル3本投稿（20分間隔）
    console.log('\n--- Scheduler: 投稿（3本、20分間隔） ---');
    const scheduler = require('../agents/scheduler');
    await scheduler.run(3, 1200);
  }

  // === 夜モード（21時）: リサーチ＋投稿＋交流 ===
  else if (mode === 'evening') {
    // 画像投稿フォールバック（朝・昼に未実施なら夜に実行）
    console.log('\n--- Image Poster: 画像投稿フォールバック ---');
    try {
      const imagePoster = require('../agents/image-poster');
      await imagePoster.run();
    } catch (err) {
      console.error(`[autopilot] image-poster エラー: ${err.message}`);
    }

    await sleep(30000);

    console.log('\n--- Researcher: 夜間ニュース収集 ---');
    const researcher = require('../agents/researcher');
    await researcher.run();

    await sleep(90000);

    // --- 社員5: コンテンツ生成 ---
    console.log('\n--- 社員5: content-poster（4本生成） ---');
    try {
      const contentPoster = require('../employees/content-poster');
      await contentPoster.run(4);
    } catch (err) {
      console.error(`[autopilot] content-poster エラー: ${err.message}`);
      const writer = require('../agents/writer');
      await writer.run(4);
    }

    await sleep(60000);

    // --- 社員4: 引用RT（夜1本） ---
    console.log('\n--- 社員4: quote-poster（1本） ---');
    try {
      const quotePoster = require('../employees/quote-poster');
      await quotePoster.run(1);
    } catch (err) {
      console.error(`[autopilot] quote-poster エラー: ${err.message}`);
      const retweeter = require('../agents/retweeter');
      await retweeter.run(1);
    }

    // --- 社員3: いいね（Freeプランでは自動スキップ） ---
    console.log('\n--- 社員3: like-worker ---');
    try {
      const likeWorker = require('../employees/like-worker');
      await likeWorker.run(5);
    } catch (err) {
      console.error(`[autopilot] like-worker エラー: ${err.message}`);
    }

    // --- 社員2: リプライ（夜1件） ---
    console.log('\n--- 社員2: reply-worker（1件） ---');
    try {
      const replyWorker = require('../employees/reply-worker');
      await replyWorker.run(1);
    } catch (err) {
      console.error(`[autopilot] reply-worker エラー: ${err.message}`);
    }

    // 夜: オリジナル3本投稿（20分間隔）
    console.log('\n--- Scheduler: 投稿（3本、20分間隔） ---');
    const scheduler = require('../agents/scheduler');
    await scheduler.run(3, 1200);
  }

  console.log('\n========================================');
  console.log(` ${mode}モード完了`);
  console.log('========================================');
}

main().catch(err => {
  console.error('[autopilot] 致命的エラー:', err);
  process.exit(1);
});
