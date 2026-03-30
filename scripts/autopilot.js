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

  // === 朝モード（7時）: フル実行 ===
  if (mode === 'morning' || mode === 'full') {
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

    console.log('\n--- Writer: 投稿生成（6本） ---');
    const writer = require('../agents/writer');
    await writer.run(6);

    await sleep(90000);

    console.log('\n--- Image Poster: 画像投稿（1日1回） ---');
    const imagePoster = require('../agents/image-poster');
    await imagePoster.run();

    await sleep(60000);

    console.log('\n--- Retweeter: 引用RT（2本） ---');
    const retweeter = require('../agents/retweeter');
    await retweeter.run(2);

    console.log('\n--- Scheduler: 投稿（5本、60秒間隔） ---');
    const scheduler = require('../agents/scheduler');
    await scheduler.run(5, 60);
  }

  // === 昼モード（12時半）: 投稿＋引用RT ===
  else if (mode === 'noon') {
    // 軽量リサーチ（バズツイート候補収集のみ）
    console.log('\n--- Researcher: バズツイート候補収集 ---');
    const researcher = require('../agents/researcher');
    await researcher.runBuzzOnly();

    await sleep(60000);

    console.log('\n--- Retweeter: 引用RT（2本） ---');
    const retweeter = require('../agents/retweeter');
    await retweeter.run(2);

    console.log('\n--- Scheduler: 投稿（3本、60秒間隔） ---');
    const scheduler = require('../agents/scheduler');
    await scheduler.run(3, 60);
  }

  // === 夜モード（21時）: リサーチ＋投稿＋引用RT ===
  else if (mode === 'evening') {
    console.log('\n--- Researcher: 夜間ニュース収集 ---');
    const researcher = require('../agents/researcher');
    await researcher.run();

    await sleep(90000);

    console.log('\n--- Writer: 投稿生成（4本） ---');
    const writer = require('../agents/writer');
    await writer.run(4);

    await sleep(60000);

    console.log('\n--- Retweeter: 引用RT（1本） ---');
    const retweeter = require('../agents/retweeter');
    await retweeter.run(1);

    console.log('\n--- Scheduler: 投稿（2本、60秒間隔） ---');
    const scheduler = require('../agents/scheduler');
    await scheduler.run(2, 60);
  }

  console.log('\n========================================');
  console.log(` ${mode}モード完了`);
  console.log('========================================');
}

main().catch(err => {
  console.error('[autopilot] 致命的エラー:', err);
  process.exit(1);
});
