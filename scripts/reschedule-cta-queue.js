/**
 * CTAキュー再スケジュール
 * - data/queue.json の cta_note を、賞味期限と話題の鮮度に応じて scheduled_at を付与する
 * - 「IPO申込期間中の銘柄ネタ」を最優先、マクロ・テーマ系は日跨ぎでゆっくり
 *
 * 使い方:
 *   node scripts/reschedule-cta-queue.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const QUEUE_PATH = path.join(__dirname, '..', 'data', 'queue.json');

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function isUrgent(t) {
  // IPO申込期間中の銘柄関連、または「今週の」「IPO4社」など期限性のあるテーマ
  const txt = (t.text || '') + ' ' + (t.theme || '');
  return /バトンズ|SQUEEZE|犬猫生活|554A|558A|556A|今週|今日|IPO当選|購入申込|IPO4社/.test(txt);
}

function isShortLife(t) {
  // 直近のIPO/上場関連（数週間で陳腐化）
  const txt = (t.text || '') + ' ' + (t.theme || '');
  return /キオクシア|285A|KOKUSAI|6525|古河|5801|梅乃宿|559A|決算速報|今日の/.test(txt);
}

// JST x:00:00 のUTC ISO文字列を返す
function jstSlot(daysFromNow, hourJst) {
  const d = new Date();
  d.setUTCHours(hourJst - 9, 0, 0, 0); // JST hour → UTC
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  // すでに過去になっていたら翌日にずらす
  if (d.getTime() < Date.now()) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const queue = readJSON(QUEUE_PATH, []);

  const ctas = queue.filter(t => t.tweet_type === 'cta_note');
  const others = queue.filter(t => t.tweet_type !== 'cta_note');

  // カテゴリ分け
  const urgent = ctas.filter(isUrgent);
  const shortLife = ctas.filter(t => !isUrgent(t) && isShortLife(t));
  const evergreen = ctas.filter(t => !isUrgent(t) && !isShortLife(t));

  console.log(`分類:`);
  console.log(`  🚨 緊急（IPO申込中）: ${urgent.length}件`);
  console.log(`  ⏰ 短命（上場直後）  : ${shortLife.length}件`);
  console.log(`  🌳 ロングライフ       : ${evergreen.length}件`);

  // スケジュール枠（朝10/昼15/夜19）×日数
  // urgent: 翌日までに全て消化（朝・昼・夜）
  // shortLife: 3日以内
  // evergreen: 1日1件で日跨ぎ
  const slots = [10, 15, 19]; // JST時刻
  let allScheduled = [];

  // urgent → 今日(残りスロット)→翌日
  let day = 0;
  let slotIdx = 0;
  // 今日の残りスロットから埋める
  const nowJstHour = (new Date().getUTCHours() + 9) % 24;
  while (slotIdx < slots.length && slots[slotIdx] <= nowJstHour) slotIdx++;

  for (const t of urgent) {
    while (slotIdx >= slots.length) { day++; slotIdx = 0; }
    t.scheduled_at = jstSlot(day, slots[slotIdx]);
    allScheduled.push(t);
    slotIdx++;
  }

  // shortLife: urgentの後ろに続けて配置
  for (const t of shortLife) {
    while (slotIdx >= slots.length) { day++; slotIdx = 0; }
    t.scheduled_at = jstSlot(day, slots[slotIdx]);
    allScheduled.push(t);
    slotIdx++;
  }

  // evergreen: 1日1件、夜枠にゆっくり
  while (day === 0 && slotIdx > 0) { day++; slotIdx = 0; }
  if (slotIdx > 0) { day++; slotIdx = 0; }
  for (const t of evergreen) {
    t.scheduled_at = jstSlot(day, 19);
    allScheduled.push(t);
    day++;
  }

  // 結果ソート
  allScheduled.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  console.log(`\n=== スケジュール ===`);
  for (const t of allScheduled) {
    const dt = new Date(t.scheduled_at);
    const jst = new Date(dt.getTime() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' ');
    const tag = isUrgent(t) ? '🚨' : (isShortLife(t) ? '⏰' : '🌳');
    console.log(`  ${tag} ${jst} JST | ${(t.text || '').slice(0, 40).replace(/\n/g, ' ')}`);
  }

  if (dryRun) {
    console.log(`\n--dry-run: 書き込みなし`);
    return;
  }

  const newQueue = [...others, ...allScheduled];
  writeJSON(QUEUE_PATH, newQueue);
  console.log(`\n✅ queue.json 更新完了 (${allScheduled.length}件にscheduled_at付与)`);
}

main();
