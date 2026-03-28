require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const Anthropic = require('@anthropic-ai/sdk');
const { uploadMedia, postTweetWithMedia } = require('../lib/x-api');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DATA_DIR = path.join(__dirname, '..', 'data');
const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');

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

// SVGの特殊文字をエスケープ
function escSvg(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// インフォグラフィックSVGを生成
function buildInfographicSVG(data) {
  const W = 1200;
  const H = 675;
  const bullets = data.bullets || [];

  // 各バレットの色（上昇=緑、下落=赤、中立=青）
  function accentColor(change) {
    if (!change) return '#4EA8DE';
    const s = String(change);
    if (s.includes('+') || s.includes('上') || s.includes('増')) return '#00E676';
    if (s.includes('-') || s.includes('下') || s.includes('減')) return '#FF5252';
    return '#4EA8DE';
  }

  const bulletsSvg = bullets.map((b, i) => {
    const y = 220 + i * 85;
    const color = accentColor(b.change);
    return `
      <rect x="80" y="${y}" width="6" height="60" rx="3" fill="${color}"/>
      <text x="110" y="${y + 22}" font-family="'Yu Gothic UI', 'Meiryo', sans-serif" font-size="22" fill="#B0BEC5">${escSvg(b.label)}</text>
      <text x="110" y="${y + 52}" font-family="'Yu Gothic UI', 'Meiryo', sans-serif" font-size="30" font-weight="bold" fill="#FFFFFF">${escSvg(b.value)}</text>
      ${b.change ? `<text x="500" y="${y + 52}" font-family="'Yu Gothic UI', 'Meiryo', sans-serif" font-size="26" font-weight="bold" fill="${color}">${escSvg(b.change)}</text>` : ''}
    `;
  }).join('');

  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0e27"/>
      <stop offset="100%" style="stop-color:#1a1f3a"/>
    </linearGradient>
  </defs>

  <!-- 背景 -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- グリッド装飾 -->
  ${Array.from({ length: 12 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="${H}" stroke="#1e2448" stroke-width="1"/>`).join('')}
  ${Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${i * 100}" x2="${W}" y2="${i * 100}" stroke="#1e2448" stroke-width="1"/>`).join('')}

  <!-- アクセントライン -->
  <rect x="80" y="80" width="60" height="4" rx="2" fill="#4EA8DE"/>

  <!-- タイトル -->
  <text x="80" y="130" font-family="'Yu Gothic UI', 'Meiryo', sans-serif" font-size="36" font-weight="bold" fill="#FFFFFF">${escSvg(data.title)}</text>

  <!-- サブタイトル -->
  ${data.subtitle ? `<text x="80" y="175" font-family="'Yu Gothic UI', 'Meiryo', sans-serif" font-size="20" fill="#78909C">${escSvg(data.subtitle)}</text>` : ''}

  <!-- データ項目 -->
  ${bulletsSvg}

  <!-- 結論 -->
  ${data.conclusion ? `
  <rect x="80" y="${220 + bullets.length * 85 + 10}" width="${W - 160}" height="50" rx="8" fill="#1a2744" stroke="#2a3a5c" stroke-width="1"/>
  <text x="100" y="${220 + bullets.length * 85 + 42}" font-family="'Yu Gothic UI', 'Meiryo', sans-serif" font-size="20" fill="#90CAF9">${escSvg(data.conclusion)}</text>
  ` : ''}

  <!-- ウォーターマーク -->
  <text x="${W - 80}" y="${H - 30}" font-family="'Yu Gothic UI', 'Meiryo', sans-serif" font-size="16" fill="#546E7A" text-anchor="end">@kaizokuokabu</text>
  <text x="80" y="${H - 30}" font-family="'Yu Gothic UI', 'Meiryo', sans-serif" font-size="14" fill="#37474F">${escSvg(today)}</text>
</svg>`;
}

// Claudeでインフォグラフィック用データを生成
async function generateInfographicData(researchItem) {
  const prompt = researchItem
    ? `以下のニュースを元に、投資家向けインフォグラフィック用のデータを作成してください。

ニュース: ${researchItem.title}
要約: ${researchItem.summary}
投資観点: ${researchItem.investment_angle}`
    : `今日の日本株または米国株に関する注目トピックについて、投資家向けインフォグラフィック用のデータを作成してください。`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `${prompt}

以下のJSON形式で出力してください：
{
  "title": "インフォグラフィックのタイトル（20文字以内、インパクトのある表現）",
  "subtitle": "サブタイトル（30文字以内）",
  "bullets": [
    { "label": "項目名", "value": "具体的な数値やデータ", "change": "+15%（変動がある場合）" }
  ],
  "conclusion": "まとめの一言（40文字以内）",
  "tweet_text": "この画像に添えるツイート本文（200文字以内、フック力のある1行目＋簡潔な解説）"
}

bullets は3〜5項目。必ず具体的な数字を含めること。
JSONのみ出力してください。`
    }],
    system: 'あなたはX（旧Twitter）の投資アカウント「kaizokuokabu」です。バズを最優先に。JSONのみ出力。'
  });

  // textブロックからJSONを抽出
  for (const block of response.content) {
    if (block.type === 'text') {
      const jsonMatch = block.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }
  }
  throw new Error('インフォグラフィックデータの生成に失敗');
}

async function run() {
  console.log('[image-poster] 画像投稿チェック...');

  const history = readJSON(path.join(DATA_DIR, 'post_history.json'));
  const today = new Date().toISOString().split('T')[0];

  // 今日すでに画像投稿済みかチェック
  const todayImagePost = history.find(h => h.type === 'image' && h.posted_at?.startsWith(today));
  if (todayImagePost) {
    console.log('[image-poster] 本日の画像投稿は実施済みです。スキップ。');
    return;
  }

  // KILL_SWITCHチェック
  if (fs.existsSync(path.join(DATA_DIR, 'KILL_SWITCH'))) {
    console.log('[image-poster] KILL_SWITCHが有効です。中止します。');
    return;
  }

  // research_poolから未使用のネタを取得（urgency高い順）
  const pool = readJSON(path.join(DATA_DIR, 'research_pool.json'));
  const unused = pool.filter(r => !r.used);
  const sorted = unused.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.urgency] || 2) - (order[b.urgency] || 2);
  });
  const researchItem = sorted[0] || null;

  console.log('[image-poster] インフォグラフィック用データを生成中...');

  try {
    // 1. Claudeでデータ生成
    const data = await generateInfographicData(researchItem);
    console.log(`  [image-poster] タイトル: ${data.title}`);

    // 2. SVG生成 → PNG変換
    const svg = buildInfographicSVG(data);
    const resvg = new Resvg(svg, { font: { loadSystemFonts: true } });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    const base64Data = Buffer.from(pngBuffer).toString('base64');
    console.log(`  [image-poster] 画像生成完了 (${Math.round(pngBuffer.length / 1024)}KB)`);

    // 3. メディアアップロード
    const mediaId = await uploadMedia(base64Data);
    if (!mediaId) {
      console.error('[image-poster] メディアアップロード失敗');
      return;
    }

    // 4. 画像付きツイート投稿
    const tweetText = data.tweet_text || data.title;
    const result = await postTweetWithMedia(tweetText, mediaId);

    if (result) {
      // 5. post_historyに記録
      history.push({
        tweet_id: result.id,
        text: tweetText,
        type: 'image',
        pattern_id: researchItem?.recommended_pattern || 'P06',
        hook_id: null,
        theme: researchItem?.theme || 'infographic',
        research_id: researchItem?.id || null,
        posted_at: new Date().toISOString(),
        metrics: null,
        fetched_at: null
      });
      writeJSON(path.join(DATA_DIR, 'post_history.json'), history);

      // researchItemをusedに
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

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
