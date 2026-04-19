/**
 * ツイート添付用カード画像生成
 * 銘柄カード / サマリーカード / データカード の3テンプレ
 * SVG → PNG（base64）で返す。x-api.uploadMedia にそのまま渡せる
 */
const { Resvg } = require('@resvg/resvg-js');

const COLORS = {
  navy: '#0A1433',
  navyLight: '#1A2D5E',
  gold: '#FFB94A',
  goldLight: '#FFD07A',
  red: '#FF5B73',
  cyan: '#5EE7FF',
  white: '#FFFFFF',
  textLight: '#AAC6FF',
  bg: '#0F1B3D'
};

const FONT = "Arial,'Noto Sans CJK JP','Yu Gothic','Meiryo',sans-serif";

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 銘柄カード: タイトル + コード + 株価 + キラーポイント3個
 * @param {Object} d
 * @param {string} d.code — 銘柄コード（"6525" 等）
 * @param {string} d.company — 銘柄名
 * @param {string} d.headline — メインコピー（1行、30字以内）
 * @param {string} d.price — 現在株価表示（"¥6,829" 等）
 * @param {string[]} d.bullets — 3つのキラーポイント
 * @param {string} d.theme — 'bull' | 'bear' | 'neutral'
 */
function buildStockCard(d) {
  const W = 1280, H = 670;
  const theme = d.theme || 'bull';

  const accent = theme === 'bear' ? COLORS.red : theme === 'neutral' ? COLORS.cyan : COLORS.gold;
  const accentLight = theme === 'bear' ? '#ff8b99' : theme === 'neutral' ? '#8de6ff' : COLORS.goldLight;
  const bgStart = theme === 'bear' ? '#1a0000' : theme === 'neutral' ? '#001a2e' : '#0a1433';
  const bgMid = theme === 'bear' ? '#3d0a0a' : theme === 'neutral' ? '#003a5c' : '#1a2d5e';
  const bgEnd = theme === 'bear' ? '#120000' : theme === 'neutral' ? '#001428' : '#0f1b3d';

  const bullets = (d.bullets || []).slice(0, 3);
  const bulletsSvg = bullets.map((b, i) => {
    const y = 420 + i * 60;
    return `
      <circle cx="100" cy="${y - 8}" r="6" fill="${accent}"/>
      <text x="130" y="${y}" font-family="${FONT}" font-size="28" font-weight="700" fill="${COLORS.white}">${esc(b)}</text>
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bgStart}"/>
      <stop offset="50%" stop-color="${bgMid}"/>
      <stop offset="100%" stop-color="${bgEnd}"/>
    </linearGradient>
    <radialGradient id="orb" cx="85%" cy="15%" r="60%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#orb)"/>

  <!-- Tag -->
  <rect x="80" y="80" width="220" height="44" rx="4" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-opacity="0.5"/>
  <text x="190" y="110" font-family="${FONT}" font-size="20" font-weight="700" fill="${accentLight}" text-anchor="middle" letter-spacing="3">STOCK ANALYSIS</text>

  <!-- Code & Company -->
  <text x="80" y="180" font-family="${FONT}" font-size="28" font-weight="900" fill="${accentLight}" letter-spacing="2">${esc(d.code || '')}</text>
  <text x="80" y="230" font-family="${FONT}" font-size="42" font-weight="900" fill="${COLORS.white}">${esc(d.company || '')}</text>

  <!-- Headline -->
  <text x="80" y="330" font-family="${FONT}" font-size="58" font-weight="900" fill="${COLORS.white}">${esc(d.headline || '')}</text>

  <!-- Bullets -->
  ${bulletsSvg}

  <!-- Price footer -->
  <rect x="0" y="${H - 70}" width="${W}" height="70" fill="#000" fill-opacity="0.4"/>
  <text x="80" y="${H - 25}" font-family="${FONT}" font-size="22" fill="${COLORS.textLight}" letter-spacing="2">CURRENT PRICE</text>
  <text x="${W - 80}" y="${H - 25}" font-family="${FONT}" font-size="36" font-weight="900" fill="${accentLight}" text-anchor="end">${esc(d.price || '')}</text>
</svg>`;
}

/**
 * 比較カード: 複数銘柄を横並びで比較
 * @param {Object} d
 * @param {string} d.title
 * @param {Array<{code,name,key_metric,verdict}>} d.stocks — 2〜4銘柄
 */
function buildComparisonCard(d) {
  const W = 1280, H = 670;
  const stocks = (d.stocks || []).slice(0, 4);
  const cardW = (W - 80 - (stocks.length - 1) * 20) / stocks.length - 40;

  const cardsSvg = stocks.map((s, i) => {
    const x = 80 + i * (cardW + 60);
    const verdict = s.verdict || '';
    const verdictColor = verdict.includes('買') || verdict.includes('◎') ? COLORS.gold
      : verdict.includes('売') || verdict.includes('×') ? COLORS.red
      : COLORS.cyan;
    return `
      <rect x="${x}" y="220" width="${cardW}" height="340" rx="16" fill="#FFFFFF" fill-opacity="0.08" stroke="${verdictColor}" stroke-opacity="0.6" stroke-width="2"/>
      <text x="${x + cardW / 2}" y="275" font-family="${FONT}" font-size="24" font-weight="700" fill="${COLORS.textLight}" text-anchor="middle" letter-spacing="2">${esc(s.code || '')}</text>
      <text x="${x + cardW / 2}" y="325" font-family="${FONT}" font-size="30" font-weight="900" fill="${COLORS.white}" text-anchor="middle">${esc(s.name || '')}</text>
      <line x1="${x + 30}" y1="355" x2="${x + cardW - 30}" y2="355" stroke="${verdictColor}" stroke-opacity="0.4"/>
      <text x="${x + cardW / 2}" y="420" font-family="${FONT}" font-size="36" font-weight="900" fill="${COLORS.white}" text-anchor="middle">${esc(s.key_metric || '')}</text>
      <text x="${x + cardW / 2}" y="510" font-family="${FONT}" font-size="40" font-weight="900" fill="${verdictColor}" text-anchor="middle">${esc(verdict)}</text>
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${COLORS.navy}"/>
      <stop offset="100%" stop-color="${COLORS.bg}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="140" fill="${COLORS.navyLight}" fill-opacity="0.5"/>
  <text x="${W / 2}" y="90" font-family="${FONT}" font-size="48" font-weight="900" fill="${COLORS.white}" text-anchor="middle">${esc(d.title || '銘柄比較')}</text>
  ${cardsSvg}
  <text x="${W / 2}" y="${H - 30}" font-family="${FONT}" font-size="22" fill="${COLORS.textLight}" text-anchor="middle" letter-spacing="3">@kaizokuokabu</text>
</svg>`;
}

/**
 * SVG → PNG Buffer → base64 文字列に変換
 * x-api.uploadMedia() にそのまま渡せる
 */
function renderSvgToBase64(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1280 },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Yu Gothic'
    }
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  return pngBuffer.toString('base64');
}

/**
 * SVG → PNG Buffer をファイルに保存（デバッグ用）
 */
function saveSvgAsPng(svg, filePath) {
  const fs = require('fs');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1280 },
    font: { loadSystemFonts: true, defaultFontFamily: 'Yu Gothic' }
  });
  fs.writeFileSync(filePath, resvg.render().asPng());
}

module.exports = {
  buildStockCard,
  buildComparisonCard,
  renderSvgToBase64,
  saveSvgAsPng
};
