const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { createWithRetry } = require('../lib/anthropic-client');
const { uploadMedia, postTweetWithMedia } = require('../lib/x-api');
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

// テキストを指定文字数で切り捨て
function truncate(str, maxLen) {
  const s = String(str || '');
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

// インフォグラフィックSVGを生成（動的レイアウト版）
function buildInfographicSVG(data) {
  const W = 1200;
  const H = 675;
  const FONT = "'Noto Sans CJK JP', 'Noto Sans JP', 'Yu Gothic UI', 'Meiryo', sans-serif";
  const PAD = 60;

  // bulletsは最大4件に絞る
  const bullets = (data.bullets || []).slice(0, 4);

  // 色決定
  function accentColor(change) {
    if (!change) return '#4EA8DE';
    const s = String(change);
    if (s.includes('+') || s.includes('上') || s.includes('増') || s.includes('高')) return '#00C853';
    if (s.includes('-') || s.includes('下') || s.includes('減') || s.includes('低')) return '#FF5252';
    return '#4EA8DE';
  }

  // 動的にy座標を計算
  // ヘッダーエリア: 60〜200px (タイトル+サブタイトル)
  // データエリア: 200〜580px
  // フッター: 580〜675px
  const dataAreaTop = 205;
  const dataAreaBottom = 575;
  const dataAreaH = dataAreaBottom - dataAreaTop;
  const itemH = bullets.length > 0 ? Math.floor(dataAreaH / bullets.length) : dataAreaH;

  const bulletsSvg = bullets.map((b, i) => {
    const itemTop = dataAreaTop + i * itemH;
    const midY = itemTop + itemH / 2;
    const color = accentColor(b.change);
    const label = truncate(b.label, 18);
    const value = truncate(b.value, 22);
    const change = b.change ? truncate(b.change, 12) : '';

    return `
      <!-- 区切り線 -->
      ${i > 0 ? `<line x1="${PAD}" y1="${itemTop}" x2="${W - PAD}" y2="${itemTop}" stroke="#1e2448" stroke-width="1"/>` : ''}
      <!-- アクセントバー -->
      <rect x="${PAD}" y="${midY - 28}" width="6" height="56" rx="3" fill="${color}"/>
      <!-- ラベル -->
      <text x="${PAD + 22}" y="${midY - 8}" font-family="${FONT}" font-size="20" fill="#90A4AE">${escSvg(label)}</text>
      <!-- 数値 -->
      <text x="${PAD + 22}" y="${midY + 26}" font-family="${FONT}" font-size="32" font-weight="bold" fill="#FFFFFF">${escSvg(value)}</text>
      <!-- 変動 -->
      ${change ? `<text x="${W - PAD - 20}" y="${midY + 26}" font-family="${FONT}" font-size="28" font-weight="bold" fill="${color}" text-anchor="end">${escSvg(change)}</text>` : ''}
    `;
  }).join('');

  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const title = truncate(data.title, 24);
  const subtitle = truncate(data.subtitle, 36);
  const conclusion = truncate(data.conclusion, 44);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#060b1a"/>
      <stop offset="100%" style="stop-color:#0f1730"/>
    </linearGradient>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#1565C0;stop-opacity:0.9"/>
      <stop offset="100%" style="stop-color:#0D47A1;stop-opacity:0.4"/>
    </linearGradient>
  </defs>

  <!-- 背景 -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- ヘッダー背景 -->
  <rect x="0" y="0" width="${W}" height="195" fill="url(#headerGrad)"/>

  <!-- アクセントライン（上部） -->
  <rect x="0" y="0" width="${W}" height="5" fill="#1E88E5"/>

  <!-- タイトル -->
  <text x="${PAD}" y="80" font-family="${FONT}" font-size="42" font-weight="bold" fill="#FFFFFF">${escSvg(title)}</text>

  <!-- サブタイトル -->
  ${subtitle ? `<text x="${PAD}" y="130" font-family="${FONT}" font-size="22" fill="#90CAF9">${escSvg(subtitle)}</text>` : ''}

  <!-- 日付タグ -->
  <rect x="${PAD}" y="148" width="200" height="32" rx="6" fill="#0D47A1"/>
  <text x="${PAD + 12}" y="170" font-family="${FONT}" font-size="16" fill="#90CAF9">${escSvg(today)}</text>

  <!-- データエリア枠 -->
  <rect x="${PAD - 10}" y="${dataAreaTop - 10}" width="${W - (PAD - 10) * 2}" height="${dataAreaH + 20}" rx="10" fill="#0a0f22" stroke="#1a2744" stroke-width="1"/>

  <!-- データ項目 -->
  ${bulletsSvg}

  <!-- 結論エリア -->
  ${conclusion ? `
  <rect x="${PAD - 10}" y="${dataAreaBottom + 10}" width="${W - (PAD - 10) * 2}" height="58" rx="8" fill="#0D47A1" opacity="0.7"/>
  <text x="${PAD + 10}" y="${dataAreaBottom + 47}" font-family="${FONT}" font-size="22" fill="#FFFFFF">💡 ${escSvg(conclusion)}</text>
  ` : ''}

  <!-- フッター -->
  <rect x="0" y="${H - 38}" width="${W}" height="38" fill="#060b1a"/>
  <text x="${PAD}" y="${H - 14}" font-family="${FONT}" font-size="15" fill="#37474F">#日本株 #投資 #kaizokuokabu</text>
  <text x="${W - PAD}" y="${H - 14}" font-family="${FONT}" font-size="18" font-weight="bold" fill="#1E88E5" text-anchor="end">@kaizokuokabu</text>
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

  const response = await createWithRetry({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `${prompt}

以下のJSON形式で出力してください：
{
  "title": "タイトル（最大20文字、インパクト重視）",
  "subtitle": "サブタイトル（最大30文字）",
  "bullets": [
    { "label": "項目名（最大12文字）", "value": "数値データ（最大18文字）", "change": "±XX%（変動がある場合のみ、最大8文字）" }
  ],
  "conclusion": "まとめ（最大38文字）",
  "tweet_text": "添付ツイート本文（最大200文字、フック力のある1行目＋簡潔な解説）"
}

重要ルール：
- bullets は3〜4項目（4項目以内厳守）
- labelは短く、valueは具体的な数字を必ず含める
- changeはパーセンテージや増減を示す場合のみ設定（例: +12.5%、-3.2%、前年比+15%）
- 全フィールドで文字数制限を厳守すること
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
