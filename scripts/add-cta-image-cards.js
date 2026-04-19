/**
 * queue.json の cta_note ツイートに imageCard を一括付与
 * 既に imageCard がある場合は上書きしない
 */
const fs = require('fs');
const path = require('path');

const QUEUE_PATH = path.join(__dirname, '..', 'data', 'queue.json');

// 銘柄別カードテンプレ
const CARD_MAP = {
  kokusai: {
    type: 'stock', theme: 'bull',
    code: '6525', company: 'KOKUSAI ELECTRIC',
    headline: 'HBM4で10,000円は通過点か', price: '¥6,829',
    bullets: ['ALDバッチ式シェア70%', 'FY2027実質PER23倍', '目標株価平均8,600円']
  },
  kioxia: {
    type: 'stock', theme: 'bull',
    code: '285A', company: 'キオクシア',
    headline: 'HBM時代のNAND王者', price: '¥19,800',
    bullets: ['世界NANDシェア17%', 'AI向け高性能SSD需要急増', '目標株価38,000円']
  },
  furukawa: {
    type: 'stock', theme: 'bull',
    code: '5801', company: '古河電気工業',
    headline: 'DC光配線で53,000円が見える', price: '¥46,650',
    bullets: ['MTPコネクタ世界シェア上位', 'FY2027純利益720〜850億円', '目標株価平均47,400円']
  },
  batonz: {
    type: 'stock', theme: 'bull',
    code: '5589', company: 'バトンズ',
    headline: 'M&A仲介ニッチで上場', price: 'IPO',
    bullets: ['事業承継市場No.1', '売上成長率+40%超', '公募価格1,010円']
  },
  squeeze: {
    type: 'stock', theme: 'bull',
    code: '5590', company: 'SQUEEZE',
    headline: 'ホテルSaaSのIPO', price: 'IPO',
    bullets: ['民泊運営DX化', 'ARR急拡大中', '公募価格1,270円']
  },
  inuneko: {
    type: 'stock', theme: 'bull',
    code: '5591', company: '犬猫生活',
    headline: 'ペットEC×保険で上場', price: 'IPO',
    bullets: ['ペット市場4.7兆円', 'ARR構成比70%', '公募価格1,050円']
  }
};

// まとめ系の比較カード
const TRIO_SUMMARY_CARD = {
  type: 'comparison',
  title: '注目株3社 徹底比較',
  stocks: [
    { code: '6525', name: 'KOKUSAI', key_metric: '6,829円', verdict: '買◎' },
    { code: '285A', name: 'キオクシア', key_metric: '19,800円', verdict: '買◎' },
    { code: '5801', name: '古河電気', key_metric: '46,650円', verdict: '押目◎' }
  ]
};

const IPO_SUMMARY_CARD = {
  type: 'comparison',
  title: '来週IPO4社 比較',
  stocks: [
    { code: '5589', name: 'バトンズ', key_metric: '¥1,010', verdict: '◎' },
    { code: '5590', name: 'SQUEEZE', key_metric: '¥1,270', verdict: '◎' },
    { code: '5591', name: '犬猫生活', key_metric: '¥1,050', verdict: '◎' },
    { code: '5592', name: 'その他', key_metric: 'IPO', verdict: '△' }
  ]
};

function pickCard(tweet) {
  const theme = tweet.theme || '';
  const id = tweet.id || '';

  if (id.includes('trio_summary')) return TRIO_SUMMARY_CARD;
  if (id.includes('summary') || id.includes('urgency') || id.includes('data')) return IPO_SUMMARY_CARD;

  for (const [key, card] of Object.entries(CARD_MAP)) {
    if (id.includes(key) || theme.toLowerCase().includes(key)) return card;
  }
  return null;
}

function main() {
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
  let added = 0, skipped = 0;

  for (const tweet of queue) {
    if (tweet.tweet_type !== 'cta_note') continue;
    if (tweet.imageCard) { skipped++; continue; }
    const card = pickCard(tweet);
    if (card) {
      tweet.imageCard = card;
      added++;
      console.log(`  ✅ ${tweet.id} ← ${card.type} (${card.code || card.title})`);
    } else {
      console.log(`  ⚠️ ${tweet.id}: マッチなし`);
    }
  }

  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
  console.log(`\n🎉 完了: ${added}本に画像カード追加、${skipped}本はスキップ（既存）`);
}

main();
