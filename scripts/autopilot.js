const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function isKillSwitchOn() {
  return fs.existsSync(path.join(DATA_DIR, 'KILL_SWITCH'));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('========================================');
  console.log(' kaizokuokabu 完全自動運転');
  console.log(` ${new Date().toLocaleString('ja-JP')}`);
  console.log('========================================\n');

  // 1. KILL_SWITCHチェック
  if (isKillSwitchOn()) {
    const reason = fs.readFileSync(path.join(DATA_DIR, 'KILL_SWITCH'), 'utf-8');
    console.error(`[autopilot] KILL_SWITCHが有効です: ${reason}`);
    console.error('[autopilot] 解除するには: bash scripts/resume.sh');
    process.exit(1);
  }

  // 2. supervisor実行
  console.log('\n--- Step 1: Supervisor チェック ---');
  const supervisor = require('../agents/supervisor');
  const { hasCritical } = await supervisor.run();
  if (hasCritical) {
    console.error('[autopilot] CRITICALアラート検出。自動運転を停止します。');
    process.exit(1);
  }

  // 3. fetcher実行
  console.log('\n--- Step 2: Fetcher メトリクス取得 ---');
  const fetcher = require('../agents/fetcher');
  await fetcher.run();

  // 4. analyst実行
  console.log('\n--- Step 3: Analyst パフォーマンス分析 ---');
  const analyst = require('../agents/analyst');
  await analyst.run();

  // 5. researcher実行
  console.log('\n--- Step 4: Researcher 最新ニュース収集 ---');
  const researcher = require('../agents/researcher');
  await researcher.run();

  // レートリミット回避のため待機
  console.log('[autopilot] レートリミット回避: 90秒待機...');
  await sleep(120000);

  // 6. writer実行
  console.log('\n--- Step 5: Writer 投稿生成（5本） ---');
  const writer = require('../agents/writer');
  await writer.run();

  // レートリミット回避のため待機
  console.log('[autopilot] レートリミット回避: 90秒待機...');
  await sleep(120000);

  // 6.5 画像投稿（1日1回）
  console.log('\n--- Step 5.5: Image Poster 画像投稿 ---');
  const imagePoster = require('../agents/image-poster');
  await imagePoster.run();

  // レートリミット回避のため待機
  console.log('[autopilot] レートリミット回避: 90秒待機...');
  await sleep(120000);

  // 7. retweeter実行
  console.log('\n--- Step 6: Retweeter 引用RT ---');
  const retweeter = require('../agents/retweeter');
  await retweeter.run();

  // 8. scheduler起動
  console.log('\n--- Step 7: Scheduler スケジュール投稿 ---');
  const scheduler = require('../agents/scheduler');
  await scheduler.run(5, 60); // 5本、60秒間隔（GitHub Actions用）

  console.log('\n========================================');
  console.log(' 自動運転完了');
  console.log('========================================');
}

main().catch(err => {
  console.error('[autopilot] 致命的エラー:', err);
  process.exit(1);
});
