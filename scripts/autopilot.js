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
    // === 朝モード：writer 6本生成 → queueに溜める ===
    // 投稿は独立 workflow (poster.yml) が4回/日で消費する
    console.log('\n--- Writer: 投稿生成（6本、queueに溜める） ---');
    try {
      const writer = require('../agents/writer');
      await writer.run(6);
    } catch (err) {
      console.error(`[autopilot] writer エラー: ${err.message}`);
    }
  }

  // === 昼モード：軽いリサーチのみ（投稿は独立workflowが担当） ===
  else if (mode === 'noon') {
    console.log('\n--- Researcher: バズツイート候補収集 ---');
    try {
      const researcher = require('../agents/researcher');
      await researcher.runBuzzOnly();
    } catch (err) {
      console.error(`[autopilot] researcher エラー: ${err.message}`);
    }
  }

  // === 夜モード：夜間ニュース取得 + writer 4本追加生成（明日朝のqueue） ===
  else if (mode === 'evening') {
    console.log('\n--- Researcher: 夜間ニュース収集 ---');
    try {
      const researcher = require('../agents/researcher');
      await researcher.run();
    } catch (err) {
      console.error(`[autopilot] researcher エラー: ${err.message}`);
    }

    await sleep(60000);

    console.log('\n--- Writer: 投稿生成（4本、夜の追加分） ---');
    try {
      const writer = require('../agents/writer');
      await writer.run(4);
    } catch (err) {
      console.error(`[autopilot] writer エラー: ${err.message}`);
    }

  }

  console.log('\n========================================');
  console.log(` ${mode}モード完了`);
  console.log('========================================');
}

main().catch(err => {
  console.error('[autopilot] 致命的エラー:', err);
  process.exit(1);
});
