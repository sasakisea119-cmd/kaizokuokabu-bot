// xAI Grok API クライアント（DEXTERのxtrend/client.tsをJS移植）
// grok-4-1-fast + x_search でXのリアルタイム投稿を検索
// コスト: $0.20/$0.50 per Mトークン（Claude Sonnetの1/15）

const BASE_URL = 'https://api.x.ai/v1/responses';
const MODEL = 'grok-4-1-fast';

function getApiKey() {
  return process.env.XAI_API_KEY || '';
}

/**
 * xAI Responses APIを呼び出す
 * @param {string} prompt - 検索クエリ/指示
 * @param {object[]} tools - ツール設定（x_searchなど）
 * @returns {Promise<object>} xAIレスポンス
 */
async function respond(prompt, tools = []) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('[grok] XAI_API_KEY が未設定です');
  }

  const body = {
    model: MODEL,
    input: [{ role: 'user', content: prompt }],
    tools,
  };

  let response;
  try {
    response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`[grok] ネットワークエラー: ${err.message}`);
  }

  if (!response.ok) {
    const errMap = {
      401: 'XAI_API_KEY が無効',
      429: 'レートリミット',
      500: 'xAIサーバーエラー',
    };
    throw new Error(`[grok] ${errMap[response.status] || `HTTP ${response.status}`}`);
  }

  return response.json();
}

/**
 * X投稿をリアルタイム検索
 * @param {string} prompt - 検索指示
 * @param {number} hours - 何時間前まで検索するか（デフォルト24）
 * @returns {Promise<string>} テキスト結果
 */
async function searchX(prompt, hours = 24) {
  const now = new Date();
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000);

  const tools = [{
    type: 'x_search',
    from_date: from.toISOString(),
    to_date: now.toISOString(),
  }];

  const data = await respond(prompt, tools);

  // outputからテキストを抽出
  const texts = [];
  for (const block of (data.output || [])) {
    if (block.type === 'message' && block.content) {
      for (const c of block.content) {
        if (c.type === 'output_text' || c.type === 'text') {
          texts.push(c.text || '');
        }
      }
    }
    if (block.text) texts.push(block.text);
  }

  return texts.join('\n');
}

/**
 * X投稿からツイートURLとIDを抽出
 * @param {string} prompt - 検索指示
 * @param {number} hours - 検索時間幅
 * @returns {Promise<Map<string, string>>} tweet_id -> context
 */
async function searchBuzzTweets(prompt, hours = 24) {
  const text = await searchX(prompt, hours);
  const tweetUrlPattern = /https?:\/\/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/g;
  const found = new Map();

  let match;
  while ((match = tweetUrlPattern.exec(text)) !== null) {
    if (!found.has(match[1])) {
      const start = Math.max(0, match.index - 100);
      const end = Math.min(text.length, match.index + match[0].length + 100);
      found.set(match[1], text.substring(start, end).trim());
    }
  }

  return found;
}

// DEXTERのテンプレート（JS版）
const TEMPLATES = {
  market_trend: (hours = 24) =>
    `日本株 相場 トレンド 直近${hours}時間 -広告 -PR の最新情報をまとめてください。` +
    '特に市場全体の方向感・出来高・セクター動向に注目してください。',

  earnings_surprise: (companyNames = '', hours = 24) =>
    companyNames
      ? `${companyNames} の決算に関する直近${hours}時間のXの投稿をまとめてください。` +
        '各社の決算サプライズ・株価反応・投資家の反応を整理してください。'
      : `直近${hours}時間の日本株決算に関するXの投稿をまとめてください。`,

  sector_theme: (sector) =>
    `「${sector} テーマ 注目 銘柄 日本株」について、Xの最新投稿から有望銘柄・材料をまとめてください。`,

  us_market_impact: (hours = 24) =>
    `直近${hours}時間の「米国株 日本市場 影響」に関するXの投稿から、日本株への影響をまとめてください。`,

  buzz_investment: (hours = 6) =>
    `直近${hours}時間でバズっている日本語の投資系ツイートを探してください。` +
    'いいね・RT数が多い投稿、議論を呼んでいる投稿を5件挙げてください。' +
    '各ツイートのURL・内容の要約・なぜバズっているかを説明してください。',
};

module.exports = { respond, searchX, searchBuzzTweets, TEMPLATES };
