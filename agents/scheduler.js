const fs = require('fs');
const path = require('path');
const { postOne } = require('./poster');

const DATA_DIR = path.join(__dirname, '..', 'data');

function isKillSwitchOn() {
  return fs.existsSync(path.join(DATA_DIR, 'KILL_SWITCH'));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run(count = 5, interval = 5400) {
  console.log(`[scheduler] スケジュール投稿開始: ${count}本 / ${interval}秒間隔`);

  for (let i = 0; i < count; i++) {
    if (isKillSwitchOn()) {
      console.log('[scheduler] KILL_SWITCHが有効です。中止します。');
      break;
    }

    console.log(`[scheduler] ${i + 1}/${count} 投稿中...`);
    const result = await postOne();

    if (!result) {
      console.log(`[scheduler] ${i + 1}/${count} 投稿失敗またはキュー空`);
    }

    // 最後の1件以外は間隔を空ける
    if (i < count - 1) {
      console.log(`[scheduler] 次の投稿まで${Math.round(interval / 60)}分待機...`);
      await sleep(interval * 1000);
    }
  }

  console.log('[scheduler] スケジュール投稿完了');
}

module.exports = { run };

if (require.main === module) {
  const args = process.argv.slice(2);
  let count = 5;
  let interval = 5400;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) count = parseInt(args[i + 1]);
    if (args[i] === '--interval' && args[i + 1]) interval = parseInt(args[i + 1]);
  }

  run(count, interval).catch(console.error);
}
