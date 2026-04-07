const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

function escSvg(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================
// デジタル庁 Light Blue カラーパレット
// ============================
const COLORS = {
  bg: '#FFFFFF',
  cardBg: '#F8F8FB',
  primary: '#0055AD',
  accent: '#008BF2',
  lightBlue: '#57B8FF',
  paleBlue: '#C0E4FF',
  icyBlue: '#F0F9FF',
  red: '#FE3939',
  lightRed: '#FFBBBB',
  textBlack: '#000000',
  textGray: '#626264',
  textLight: '#949494',
  border: '#E6E6E6',
  gridLine: '#E6E6E6',
  green: '#4AC5BB',
};

const FONT = "Arial,'Noto Sans CJK JP','Yu Gothic UI','Meiryo',sans-serif";
const RADIUS = 12;

// ============================
// カード1: 市場サマリーカード（朝用）
// ============================
function buildMarketSummaryCard(data) {
  const W = 1200, H = 675;
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  const items = data.items || [];
  const itemH = 80;
  const itemStartY = 200;

  const itemsSvg = items.map((item, i) => {
    const y = itemStartY + i * (itemH + 12);
    const changeStr = String(item.change);
    const isPositive = changeStr.includes('+');
    const isNegative = changeStr.includes('-');
    const changeColor = isPositive ? COLORS.green : isNegative ? COLORS.red : COLORS.textGray;
    const arrow = isPositive ? '\u25B2' : isNegative ? '\u25BC' : '';

    return `
      <!-- Card row -->
      <rect x="60" y="${y}" width="${W - 120}" height="${itemH}" rx="${RADIUS}" fill="${COLORS.cardBg}"/>
      <!-- Accent bar -->
      <rect x="60" y="${y}" width="5" height="${itemH}" rx="2.5" fill="${COLORS.accent}"/>
      <!-- Label -->
      <text x="85" y="${y + 30}" font-family="${FONT}" font-size="16" fill="${COLORS.textLight}">${escSvg(item.label)}</text>
      <!-- Value -->
      <text x="85" y="${y + 58}" font-family="${FONT}" font-size="28" font-weight="bold" fill="${COLORS.textBlack}">${escSvg(item.value)}</text>
      <!-- Change -->
      <text x="${W - 80}" y="${y + 50}" font-family="${FONT}" font-size="24" font-weight="bold" fill="${changeColor}" text-anchor="end">${arrow} ${escSvg(item.change)}</text>
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="${W}" height="${H}" fill="${COLORS.bg}"/>

  <!-- Top accent line -->
  <rect x="0" y="0" width="${W}" height="4" fill="${COLORS.accent}"/>

  <!-- Header area -->
  <rect x="0" y="4" width="${W}" height="180" fill="${COLORS.icyBlue}"/>

  <!-- Badge -->
  <rect x="60" y="28" width="180" height="30" rx="15" fill="${COLORS.accent}"/>
  <text x="150" y="49" font-family="${FONT}" font-size="14" font-weight="bold" fill="#FFFFFF" text-anchor="middle">MARKET SUMMARY</text>

  <!-- Title -->
  <text x="60" y="108" font-family="${FONT}" font-size="38" font-weight="bold" fill="${COLORS.primary}">${escSvg(data.title)}</text>

  <!-- Subtitle -->
  <text x="60" y="145" font-family="${FONT}" font-size="18" fill="${COLORS.textGray}">${escSvg(data.subtitle)}</text>

  <!-- Date -->
  <text x="60" y="174" font-family="${FONT}" font-size="14" fill="${COLORS.textLight}">${escSvg(today)}</text>

  <!-- Data items -->
  ${itemsSvg}

  <!-- Footer line -->
  <rect x="60" y="${H - 48}" width="${W - 120}" height="1" fill="${COLORS.border}"/>

  <!-- Footer -->
  <text x="60" y="${H - 18}" font-family="${FONT}" font-size="13" fill="${COLORS.textLight}">#IPO #日本株 #投資 #マーケット</text>
  <text x="${W - 60}" y="${H - 18}" font-family="${FONT}" font-size="16" font-weight="bold" fill="${COLORS.accent}" text-anchor="end">@kaizokuokabu</text>
</svg>`;
}

// ============================
// カード2: IPO銘柄スコアカード（昼用）
// ============================
function buildIPOScoreCard(data) {
  const W = 1200, H = 675;

  const score = data.score || 72;
  const scoreWidth = Math.min(score / 100 * 500, 500);
  const scoreColor = score >= 70 ? COLORS.green : score >= 50 ? '#FDB15D' : COLORS.red;
  const verdict = data.verdict || '様子見';
  const verdictColor = verdict.includes('買') || verdict.includes('注目') ? COLORS.accent : verdict.includes('見送') ? COLORS.red : '#FDB15D';

  const metrics = data.metrics || [];
  const metricsSvg = metrics.map((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 60 + col * 545;
    const y = 380 + row * 100;

    return `
      <rect x="${x}" y="${y}" width="520" height="${85}" rx="${RADIUS}" fill="${COLORS.cardBg}"/>
      <rect x="${x}" y="${y}" width="4" height="${85}" rx="2" fill="${COLORS.lightBlue}"/>
      <text x="${x + 20}" y="${y + 30}" font-family="${FONT}" font-size="14" fill="${COLORS.textLight}">${escSvg(m.label)}</text>
      <text x="${x + 20}" y="${y + 62}" font-family="${FONT}" font-size="26" font-weight="bold" fill="${COLORS.textBlack}">${escSvg(m.value)}</text>
      ${m.note ? `<text x="${x + 500}" y="${y + 55}" font-family="${FONT}" font-size="13" fill="${COLORS.textLight}" text-anchor="end">${escSvg(m.note)}</text>` : ''}
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${COLORS.bg}"/>
  <rect x="0" y="0" width="${W}" height="4" fill="${COLORS.primary}"/>

  <!-- Header -->
  <rect x="0" y="4" width="${W}" height="350" fill="${COLORS.icyBlue}"/>

  <!-- Badge -->
  <rect x="60" y="28" width="200" height="30" rx="15" fill="${COLORS.primary}"/>
  <text x="160" y="49" font-family="${FONT}" font-size="14" font-weight="bold" fill="#FFFFFF" text-anchor="middle">IPO SCORE CARD</text>

  <!-- Company name -->
  <text x="60" y="120" font-family="${FONT}" font-size="48" font-weight="bold" fill="${COLORS.primary}">${escSvg(data.company)}</text>
  <text x="60" y="158" font-family="${FONT}" font-size="20" fill="${COLORS.textGray}">${escSvg(data.code)} | ${escSvg(data.sector)}</text>

  <!-- Score label -->
  <text x="60" y="210" font-family="${FONT}" font-size="16" fill="${COLORS.textGray}">IPO総合スコア</text>

  <!-- Score bar background -->
  <rect x="60" y="222" width="500" height="18" rx="9" fill="${COLORS.border}"/>
  <!-- Score bar fill -->
  <rect x="60" y="222" width="${scoreWidth}" height="18" rx="9" fill="${scoreColor}"/>
  <!-- Score number -->
  <text x="580" y="240" font-family="${FONT}" font-size="32" font-weight="bold" fill="${scoreColor}">${score}<tspan font-size="18" fill="${COLORS.textLight}">/100</tspan></text>

  <!-- Verdict badge -->
  <rect x="60" y="262" width="200" height="44" rx="22" fill="${verdictColor}" opacity="0.15"/>
  <rect x="60" y="262" width="200" height="44" rx="22" fill="none" stroke="${verdictColor}" stroke-width="2"/>
  <text x="160" y="291" font-family="${FONT}" font-size="22" font-weight="bold" fill="${verdictColor}" text-anchor="middle">${escSvg(verdict)}</text>

  <!-- Key point -->
  <text x="280" y="291" font-family="${FONT}" font-size="17" fill="${COLORS.textGray}">${escSvg(data.keyPoint || '')}</text>

  <!-- Section divider -->
  <text x="60" y="365" font-family="${FONT}" font-size="16" font-weight="bold" fill="${COLORS.primary}">Key Metrics</text>
  <rect x="60" y="372" width="${W - 120}" height="1" fill="${COLORS.border}"/>

  <!-- Metrics -->
  ${metricsSvg}

  <!-- Footer -->
  <rect x="60" y="${H - 48}" width="${W - 120}" height="1" fill="${COLORS.border}"/>
  <text x="60" y="${H - 18}" font-family="${FONT}" font-size="13" fill="${COLORS.textLight}">#IPO #${escSvg(data.company)} #新規上場</text>
  <text x="${W - 60}" y="${H - 18}" font-family="${FONT}" font-size="16" font-weight="bold" fill="${COLORS.accent}" text-anchor="end">@kaizokuokabu</text>
</svg>`;
}

// ============================
// カード3: IPO成績レポートカード（夜用）
// ============================
function buildIPOPerformanceCard(data) {
  const W = 1200, H = 675;

  const stats = data.stats || [];
  const statW = 250;
  const totalStatsW = stats.length * statW + (stats.length - 1) * 16;
  const statsStartX = (W - totalStatsW) / 2;

  const statsSvg = stats.map((s, i) => {
    const x = statsStartX + i * (statW + 16);
    const valueColor = s.color || COLORS.accent;

    return `
      <rect x="${x}" y="195" width="${statW}" height="135" rx="${RADIUS}" fill="${COLORS.cardBg}"/>
      <text x="${x + statW / 2}" y="235" font-family="${FONT}" font-size="14" fill="${COLORS.textLight}" text-anchor="middle">${escSvg(s.label)}</text>
      <text x="${x + statW / 2}" y="285" font-family="${FONT}" font-size="40" font-weight="bold" fill="${valueColor}" text-anchor="middle">${escSvg(s.value)}</text>
      <text x="${x + statW / 2}" y="318" font-family="${FONT}" font-size="13" fill="${COLORS.textLight}" text-anchor="middle">${escSvg(s.note || '')}</text>
    `;
  }).join('');

  const rankings = data.rankings || [];
  const rankStartY = 375;
  const rankH = 55;

  const rankSvg = rankings.map((r, i) => {
    const y = rankStartY + i * (rankH + 8);
    const changeStr = String(r.change);
    const isPositive = changeStr.includes('+');
    const changeColor = isPositive ? COLORS.green : COLORS.red;
    const rankNum = i + 1;
    const rankBg = i === 0 ? COLORS.accent : i === 1 ? COLORS.lightBlue : i === 2 ? COLORS.paleBlue : COLORS.cardBg;
    const rankTextColor = i <= 1 ? '#FFFFFF' : COLORS.primary;

    return `
      <rect x="60" y="${y}" width="${W - 120}" height="${rankH}" rx="8" fill="${COLORS.cardBg}"/>
      <!-- Rank badge -->
      <rect x="75" y="${y + 10}" width="35" height="35" rx="8" fill="${rankBg}"/>
      <text x="92" y="${y + 34}" font-family="${FONT}" font-size="18" font-weight="bold" fill="${rankTextColor}" text-anchor="middle">${rankNum}</text>
      <!-- Name -->
      <text x="130" y="${y + 35}" font-family="${FONT}" font-size="20" fill="${COLORS.textBlack}">${escSvg(r.name)} <tspan fill="${COLORS.textLight}">(${escSvg(r.code)})</tspan></text>
      <!-- Change -->
      <text x="${W - 80}" y="${y + 36}" font-family="${FONT}" font-size="24" font-weight="bold" fill="${changeColor}" text-anchor="end">${escSvg(r.change)}</text>
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${COLORS.bg}"/>
  <rect x="0" y="0" width="${W}" height="4" fill="${COLORS.primary}"/>

  <!-- Header -->
  <rect x="0" y="4" width="${W}" height="178" fill="${COLORS.icyBlue}"/>

  <!-- Badge -->
  <rect x="60" y="28" width="220" height="30" rx="15" fill="${COLORS.primary}"/>
  <text x="170" y="49" font-family="${FONT}" font-size="14" font-weight="bold" fill="#FFFFFF" text-anchor="middle">IPO PERFORMANCE</text>

  <!-- Title -->
  <text x="60" y="108" font-family="${FONT}" font-size="38" font-weight="bold" fill="${COLORS.primary}">${escSvg(data.title)}</text>
  <text x="60" y="145" font-family="${FONT}" font-size="18" fill="${COLORS.textGray}">${escSvg(data.subtitle)}</text>

  <!-- Stats cards -->
  ${statsSvg}

  <!-- Ranking section -->
  <text x="60" y="360" font-family="${FONT}" font-size="16" font-weight="bold" fill="${COLORS.primary}">${escSvg(data.rankingTitle || 'IPO初値パフォーマンス')}</text>
  <rect x="60" y="367" width="${W - 120}" height="1" fill="${COLORS.border}"/>

  ${rankSvg}

  <!-- Footer -->
  <rect x="60" y="${H - 48}" width="${W - 120}" height="1" fill="${COLORS.border}"/>
  <text x="60" y="${H - 18}" font-family="${FONT}" font-size="13" fill="${COLORS.textLight}">#IPO成績 #新規上場 #初値</text>
  <text x="${W - 60}" y="${H - 18}" font-family="${FONT}" font-size="16" font-weight="bold" fill="${COLORS.accent}" text-anchor="end">@kaizokuokabu</text>
</svg>`;
}


// ============================
// プレビュー生成
// ============================
function renderAndSave(svgStr, filename) {
  const resvg = new Resvg(svgStr, {
    font: { loadSystemFonts: true },
    fitTo: { mode: 'width', value: 1200 }
  });
  const png = resvg.render().asPng();
  const outPath = path.join(__dirname, '..', 'data', filename);
  fs.writeFileSync(outPath, png);
  console.log(`Saved: ${outPath} (${Math.round(png.length / 1024)}KB)`);
}

// サンプルデータ
const marketData = {
  title: 'IPO冬の時代の市場サマリー',
  subtitle: '日経反発も、IPOセカンダリーは軟調続く',
  items: [
    { label: '日経平均', value: '33,541円', change: '-285円' },
    { label: 'タイミー (215A)', value: '1,311円', change: '-4.2%' },
    { label: 'セイワHD (523A)', value: '1,391円', change: '+14.0%' },
    { label: '2026年IPO勝率', value: '38% (19勝31敗)', change: '過去最低' },
  ]
};

const scoreData = {
  company: 'タイミー',
  code: '215A',
  sector: 'スキマバイトプラットフォーム',
  score: 68,
  verdict: 'セカンダリー注目',
  keyPoint: 'PEGレシオ0.87は割安。メルカリ参入が最大リスク',
  metrics: [
    { label: 'PER (株価収益率)', value: '52.3倍', note: '業界平均38倍' },
    { label: '売上成長率', value: '+28.4%', note: '前年比' },
    { label: 'PEGレシオ', value: '0.87', note: '1.0未満で割安' },
    { label: '初値からの下落率', value: '-29.1%', note: '公募価格1,450円' },
  ]
};

const perfData = {
  title: '2026年4月 IPO成績レポート',
  subtitle: '公募割れ率62% — 過去10年ワースト更新',
  stats: [
    { label: 'IPO件数', value: '50社', note: '前年同期比-15%', color: COLORS.accent },
    { label: '公募割れ率', value: '62%', note: '31社/50社', color: COLORS.red },
    { label: '平均初値騰落', value: '-8.3%', note: '過去最低', color: COLORS.red },
    { label: 'セカンダリー復活率', value: '34%', note: '公募割れ後+20%以上', color: COLORS.green },
  ],
  rankingTitle: '公募割れ後の復活ランキング TOP4',
  rankings: [
    { name: 'セイワHD', code: '523A', change: '+14.0%' },
    { name: 'オルツ', code: '260A', change: '+8.5%' },
    { name: 'インテグループ', code: '192A', change: '+6.2%' },
    { name: 'Sapeet', code: '269A', change: '-12.3%' },
  ]
};

// 生成実行
renderAndSave(buildMarketSummaryCard(marketData), 'preview_card1_market.png');
renderAndSave(buildIPOScoreCard(scoreData), 'preview_card2_score.png');
renderAndSave(buildIPOPerformanceCard(perfData), 'preview_card3_perf.png');

console.log('\nDone! 3 preview cards generated (Digital Agency Light Blue style).');
