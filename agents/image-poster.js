const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { createWithRetry } = require('../lib/anthropic-client');
const { uploadMedia, postTweetWithMedia } = require('../lib/x-api');
const { findDuplicate } = require('../lib/dedup');
const { buildFreshnessContext, logAndGuardFreshness } = require('../lib/freshness');
const DATA_DIR = path.join(__dirname, '..', 'data');

function readJSON(filePath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function escSvg(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
      <rect x="60" y="${y}" width="${W - 120}" height="${itemH}" rx="${RADIUS}" fill="${COLORS.cardBg}"/>
      <rect x="60" y="${y}" width="5" height="${itemH}" rx="2.5" fill="${COLORS.accent}"/>
      <text x="85" y="${y + 30}" font-family="${FONT}" font-size="16" fill="${COLORS.textLight}">${escSvg(item.label)}</text>
      <text x="85" y="${y + 58}" font-family="${FONT}" font-size="28" font-weight="bold" fill="${COLORS.textBlack}">${escSvg(item.value)}</text>
      <text x="${W - 80}" y="${y + 50}" font-family="${FONT}" font-size="24" font-weight="bold" fill="${changeColor}" text-anchor="end">${arrow} ${escSvg(item.change)}</text>
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${COLORS.bg}"/>
  <rect x="0" y="0" width="${W}" height="4" fill="${COLORS.accent}"/>
  <rect x="0" y="4" width="${W}" height="180" fill="${COLORS.icyBlue}"/>
  <rect x="60" y="28" width="180" height="30" rx="15" fill="${COLORS.accent}"/>
  <text x="150" y="49" font-family="${FONT}" font-size="14" font-weight="bold" fill="#FFFFFF" text-anchor="middle">MARKET SUMMARY</text>
  <text x="60" y="108" font-family="${FONT}" font-size="38" font-weight="bold" fill="${COLORS.primary}">${escSvg(data.title)}</text>
  <text x="60" y="145" font-family="${FONT}" font-size="18" fill="${COLORS.textGray}">${escSvg(data.subtitle)}</text>
  <text x="60" y="174" font-family="${FONT}" font-size="14" fill="${COLORS.textLight}">${escSvg(today)}</text>
  ${itemsSvg}
  <rect x="60" y="${H - 48}" width="${W - 120}" height="1" fill="${COLORS.border}"/>
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
      <rect x="${x}" y="${y}" width="520" height="85" rx="${RADIUS}" fill="${COLORS.cardBg}"/>
      <rect x="${x}" y="${y}" width="4" height="85" rx="2" fill="${COLORS.lightBlue}"/>
      <text x="${x + 20}" y="${y + 30}" font-family="${FONT}" font-size="14" fill="${COLORS.textLight}">${escSvg(m.label)}</text>
      <text x="${x + 20}" y="${y + 62}" font-family="${FONT}" font-size="26" font-weight="bold" fill="${COLORS.textBlack}">${escSvg(m.value)}</text>
      ${m.note ? `<text x="${x + 500}" y="${y + 55}" font-family="${FONT}" font-size="13" fill="${COLORS.textLight}" text-anchor="end">${escSvg(m.note)}</text>` : ''}
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${COLORS.bg}"/>
  <rect x="0" y="0" width="${W}" height="4" fill="${COLORS.primary}"/>
  <rect x="0" y="4" width="${W}" height="350" fill="${COLORS.icyBlue}"/>
  <rect x="60" y="28" width="200" height="30" rx="15" fill="${COLORS.primary}"/>
  <text x="160" y="49" font-family="${FONT}" font-size="14" font-weight="bold" fill="#FFFFFF" text-anchor="middle">IPO SCORE CARD</text>
  <text x="60" y="120" font-family="${FONT}" font-size="48" font-weight="bold" fill="${COLORS.primary}">${escSvg(data.company)}</text>
  <text x="60" y="158" font-family="${FONT}" font-size="20" fill="${COLORS.textGray}">${escSvg(data.code)} | ${escSvg(data.sector)}</text>
  <text x="60" y="210" font-family="${FONT}" font-size="16" fill="${COLORS.textGray}">IPO総合スコア</text>
  <rect x="60" y="222" width="500" height="18" rx="9" fill="${COLORS.border}"/>
  <rect x="60" y="222" width="${scoreWidth}" height="18" rx="9" fill="${scoreColor}"/>
  <text x="580" y="240" font-family="${FONT}" font-size="32" font-weight="bold" fill="${scoreColor}">${score}<tspan font-size="18" fill="${COLORS.textLight}">/100</tspan></text>
  <rect x="60" y="262" width="200" height="44" rx="22" fill="${verdictColor}" opacity="0.15"/>
  <rect x="60" y="262" width="200" height="44" rx="22" fill="none" stroke="${verdictColor}" stroke-width="2"/>
  <text x="160" y="291" font-family="${FONT}" font-size="22" font-weight="bold" fill="${verdictColor}" text-anchor="middle">${escSvg(verdict)}</text>
  <text x="280" y="291" font-family="${FONT}" font-size="17" fill="${COLORS.textGray}">${escSvg(data.keyPoint || '')}</text>
  <text x="60" y="365" font-family="${FONT}" font-size="16" font-weight="bold" fill="${COLORS.primary}">Key Metrics</text>
  <rect x="60" y="372" width="${W - 120}" height="1" fill="${COLORS.border}"/>
  ${metricsSvg}
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
    const isPositive = String(r.change).includes('+');
    const changeColor = isPositive ? COLORS.green : COLORS.red;
    const rankNum = i + 1;
    const rankBg = i === 0 ? COLORS.accent : i === 1 ? COLORS.lightBlue : i === 2 ? COLORS.paleBlue : COLORS.cardBg;
    const rankTextColor = i <= 1 ? '#FFFFFF' : COLORS.primary;
    return `
      <rect x="60" y="${y}" width="${W - 120}" height="${rankH}" rx="8" fill="${COLORS.cardBg}"/>
      <rect x="75" y="${y + 10}" width="35" height="35" rx="8" fill="${rankBg}"/>
      <text x="92" y="${y + 34}" font-family="${FONT}" font-size="18" font-weight="bold" fill="${rankTextColor}" text-anchor="middle">${rankNum}</text>
      <text x="130" y="${y + 35}" font-family="${FONT}" font-size="20" fill="${COLORS.textBlack}">${escSvg(r.name)} <tspan fill="${COLORS.textLight}">(${escSvg(r.code)})</tspan></text>
      <text x="${W - 80}" y="${y + 36}" font-family="${FONT}" font-size="24" font-weight="bold" fill="${changeColor}" text-anchor="end">${escSvg(r.change)}</text>
    `;
  }).join('');

  // データ定義（methodology）をフッター上に表示
  const methodology = data.methodology || '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${COLORS.bg}"/>
  <rect x="0" y="0" width="${W}" height="4" fill="${COLORS.primary}"/>
  <rect x="0" y="4" width="${W}" height="178" fill="${COLORS.icyBlue}"/>
  <rect x="60" y="28" width="220" height="30" rx="15" fill="${COLORS.primary}"/>
  <text x="170" y="49" font-family="${FONT}" font-size="14" font-weight="bold" fill="#FFFFFF" text-anchor="middle">IPO PERFORMANCE</text>
  <text x="60" y="108" font-family="${FONT}" font-size="38" font-weight="bold" fill="${COLORS.primary}">${escSvg(data.title)}</text>
  <text x="60" y="145" font-family="${FONT}" font-size="18" fill="${COLORS.textGray}">${escSvg(data.subtitle)}</text>
  ${statsSvg}
  <text x="60" y="360" font-family="${FONT}" font-size="16" font-weight="bold" fill="${COLORS.primary}">${escSvg(data.rankingTitle || 'IPO初値パフォーマンス')}</text>
  <rect x="60" y="367" width="${W - 120}" height="1" fill="${COLORS.border}"/>
  ${rankSvg}
  ${methodology ? `<text x="60" y="${H - 52}" font-family="${FONT}" font-size="11" fill="${COLORS.textLight}">${escSvg(methodology)}</text>` : ''}
  <rect x="60" y="${H - 42}" width="${W - 120}" height="1" fill="${COLORS.border}"/>
  <text x="60" y="${H - 18}" font-family="${FONT}" font-size="13" fill="${COLORS.textLight}">#IPO成績 #新規上場 #初値</text>
  <text x="${W - 60}" y="${H - 18}" font-family="${FONT}" font-size="16" font-weight="bold" fill="${COLORS.accent}" text-anchor="end">@kaizokuokabu</text>
</svg>`;
}

// ============================
// カードタイプをランダム選択（時間帯ベース）
// ============================
function getCardType() {
  const jstHour = (new Date().getUTCHours() + 9) % 24;
  if (jstHour >= 5 && jstHour < 11) return 'market';    // 朝
  if (jstHour >= 11 && jstHour < 17) return 'score';    // 昼
  return 'performance';                                    // 夜
}

// ============================
// Claudeでカードデータ生成
// ============================
async function generateCardData(cardType, researchItem) {
  const context = researchItem
    ? `ニュース: ${researchItem.title}\n要約: ${researchItem.summary}\n投資観点: ${researchItem.investment_angle}`
    : '今日の日本株・IPO市場に関する最新トピック';

  const prompts = {
    market: `${buildFreshnessContext()}

以下を元に、朝の市場サマリーカード用データを作成してください。
${context}

🚨 最重要：データ取得手順（厳守）
1. **必ず web_search ツールを使用して本日の最新データを取得すること**
2. 取得する情報：本日の日経平均終値、注目銘柄の株価、IPO市況の最新情報
3. 学習データから株価・指数を記憶で書くことを絶対に禁止する（古い数字で出すな）
4. web_searchで数値が取得できなかった指標は、具体数値を出さず定性的に書く（例：「年初来高値圏」「前日比上昇」）

JSON形式で出力：
{
  "title": "タイトル（最大20文字）",
  "subtitle": "サブタイトル（最大30文字）",
  "items": [
    { "label": "指標名（最大15文字）", "value": "数値（最大15文字、web_searchで確認した本日値のみ）", "change": "変動（例: +1.2%, -285円）" }
  ],
  "tweet_text": "添付ツイート本文（最大200文字、1行目はフック）"
}
重要: itemsは4件。日経平均・注目IPO銘柄2つ・IPO全体の指標で構成。JSONのみ出力。`,

    score: `${buildFreshnessContext()}

以下を元に、IPO銘柄スコアカード用データを作成してください。直近3年以内のIPO銘柄を1つ選んで分析。

🚨 重要：web_search ツールを使用して対象銘柄の最新株価・業績を取得してから書くこと。学習データの古い数字は使わない。PER/PBR/騰落率など鮮度に依存しない数字を優先的に使用。

${context}

JSON形式で出力：
{
  "company": "企業名（最大10文字）",
  "code": "証券コード",
  "sector": "業種説明（最大20文字）",
  "score": 0〜100の整数（総合スコア）,
  "verdict": "判定（例: セカンダリー注目 / 様子見 / 買い検討 / 見送り）",
  "keyPoint": "要点1文（最大30文字）",
  "metrics": [
    { "label": "指標名（最大15文字）", "value": "数値", "note": "補足（最大10文字）" }
  ],
  "tweet_text": "添付ツイート本文（最大200文字、1行目はフック）"
}
重要: metricsは4件（PER・成長率・PEGレシオ等）。JSONのみ出力。`,

    performance: `${buildFreshnessContext()}

以下を元に、IPO成績レポートカード用データを作成してください。

🚨 重要：web_search ツールを使用して本日時点の最新IPO情報を取得すること。methodology に記載する「対象期間」は**本日から過去を遡った範囲**で書く（例：現在が2026年4月なら「2026年1-4月」）。学習データの記憶で書くな。

${context}

JSON形式で出力：
{
  "title": "タイトル（最大20文字）",
  "subtitle": "サブタイトル（最大30文字）",
  "stats": [
    { "label": "統計名（最大10文字）", "value": "数値", "note": "補足", "color": "カラーコード（青#008BF2/赤#FE3939/緑#4AC5BB）" }
  ],
  "rankingTitle": "ランキングタイトル（最大25文字）",
  "rankings": [
    { "name": "企業名", "code": "証券コード", "change": "騰落率（例: +14.0%）" }
  ],
  "methodology": "対象: 2026年1月〜4月上場の全IPO銘柄。騰落率は公募価格比。",
  "tweet_text": "添付ツイート本文（最大280文字）。冒頭に【データ定義】対象: 2026年1-4月上場全銘柄、公募価格比の騰落率 と明記すること"
}
重要ルール：
- statsは4件、rankingsは4件
- methodologyに必ずデータの定義（対象銘柄の抽出条件・期間・比較基準）を明記すること
- tweet_textにもデータの定義を1行で含めること（例:「対象: 2026年1-4月の全IPO銘柄50社、公募価格比」）
- JSONのみ出力`
  };

  const response = await createWithRetry({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: prompts[cardType]
    }],
    system: `あなたはX（旧Twitter）のIPO投資アカウント「kaizokuokabu」です。IPOを誰よりも面白く、わかりやすく伝える。

${buildFreshnessContext()}

ランキング・データを出す場合は必ず対象銘柄の抽出条件と期間を明記する。
株価・指数は必ず web_search ツールで最新値を取得してから書く（学習データの記憶を絶対に使わない）。
web_searchで取得できなければ定性的表現に切り替える。
JSONのみ出力。`
  });

  for (const block of response.content) {
    if (block.type === 'text') {
      const jsonMatch = block.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
  }
  throw new Error('カードデータの生成に失敗');
}

// ============================
// メインの実行関数
// ============================
async function run() {
  console.log('[image-poster] 画像投稿チェック...');

  const history = readJSON(path.join(DATA_DIR, 'post_history.json'));
  const today = new Date().toISOString().split('T')[0];

  const todayImagePost = history.find(h => h.type === 'image' && h.posted_at?.startsWith(today));
  if (todayImagePost) {
    console.log('[image-poster] 本日の画像投稿は実施済みです。スキップ。');
    return;
  }

  if (fs.existsSync(path.join(DATA_DIR, 'KILL_SWITCH'))) {
    console.log('[image-poster] KILL_SWITCHが有効です。中止します。');
    return;
  }

  // research_poolから未使用のネタを取得
  const pool = readJSON(path.join(DATA_DIR, 'research_pool.json'));
  const unused = pool.filter(r => !r.used);
  const sorted = unused.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.urgency] || 2) - (order[b.urgency] || 2);
  });
  const researchItem = sorted[0] || null;

  const cardType = getCardType();
  console.log(`[image-poster] カードタイプ: ${cardType}`);
  console.log('[image-poster] カードデータを生成中...');

  try {
    const data = await generateCardData(cardType, researchItem);
    console.log(`  [image-poster] タイトル: ${data.title || data.company}`);

    // SVG生成
    let svg;
    switch (cardType) {
      case 'market':
        svg = buildMarketSummaryCard(data);
        break;
      case 'score':
        svg = buildIPOScoreCard(data);
        break;
      case 'performance':
        svg = buildIPOPerformanceCard(data);
        break;
      default:
        svg = buildMarketSummaryCard(data);
    }

    // SVG → PNG変換
    const resvg = new Resvg(svg, { font: { loadSystemFonts: true } });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    const base64Data = Buffer.from(pngBuffer).toString('base64');
    console.log(`  [image-poster] 画像生成完了 (${Math.round(pngBuffer.length / 1024)}KB)`);

    // メディアアップロード
    const mediaId = await uploadMedia(base64Data);
    if (!mediaId) {
      console.error('[image-poster] メディアアップロード失敗');
      return;
    }

    // 画像付きツイート投稿
    const tweetText = data.tweet_text || data.title || data.company;

    // 重複防止ガード（直近48hの類似投稿チェック）
    const dup = findDuplicate(tweetText, history, { hours: 48 });
    if (dup.isDuplicate) {
      console.warn(`[image-poster] 重複検出 → 投稿スキップ (${dup.reason})`);
      return;
    }

    // 鮮度ガード（社長方針：1日前までのデータ基準）
    const guard = logAndGuardFreshness('image-poster', tweetText, history);
    if (guard.blocked) {
      console.warn(`[image-poster] 鮮度リスクで投稿スキップ`);
      return;
    }

    const result = await postTweetWithMedia(tweetText, mediaId);

    if (result) {
      history.push({
        tweet_id: result.id,
        text: tweetText,
        type: 'image',
        card_type: cardType,
        pattern_id: researchItem?.recommended_pattern || 'IMG',
        hook_id: null,
        theme: researchItem?.theme || `image_${cardType}`,
        research_id: researchItem?.id || null,
        posted_at: new Date().toISOString(),
        metrics: null,
        fetched_at: null
      });
      writeJSON(path.join(DATA_DIR, 'post_history.json'), history);

      if (researchItem) {
        researchItem.used = true;
        writeJSON(path.join(DATA_DIR, 'research_pool.json'), pool);
      }

      console.log(`[image-poster] 画像付き投稿成功: ${result.id}`);
    }
  } catch (err) {
    console.error(`[image-poster] エラー: ${err.message}`);
  }
}

module.exports = { run, buildMarketSummaryCard, buildIPOScoreCard, buildIPOPerformanceCard };

if (require.main === module) {
  run().catch(console.error);
}
