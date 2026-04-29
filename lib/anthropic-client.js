/**
 * Anthropic互換クライアント（実体はGoogle Gemini API）
 *
 * 既存コードは `createWithRetry({ model, max_tokens, messages, system, tools })` を呼んでいるので、
 * このシグネチャを保ちながら内部で Gemini API に変換する。
 * 戻り値も Anthropic互換 `{ content: [{ type:'text', text:'...' }] }` 形式にする。
 *
 * モデル名のマッピング：
 * - claude-sonnet-* / claude-opus-*    → gemini-2.5-flash（高品質生成用）
 * - claude-haiku-*                      → gemini-2.0-flash（軽量・高速・激安）
 *
 * Gemini Free tier (個人利用):
 * - 15 RPM / 1M TPM / 1500 RPD（gemini-2.5-flash）
 * - うちの規模なら完全無料で運用可能
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });

const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY;
if (!apiKey) {
  console.warn('[gemini-client] GEMINI_API_KEY が未設定です。process.env.GEMINI_API_KEY を確認してください。');
}

const client = apiKey ? new GoogleGenerativeAI(apiKey) : null;

/**
 * Anthropicモデル名 → Geminiモデル名へのマッピング
 */
function mapModel(anthropicModel) {
  if (!anthropicModel) return 'gemini-2.5-flash';
  const m = String(anthropicModel).toLowerCase();
  if (m.includes('haiku')) return 'gemini-2.0-flash';
  if (m.includes('opus')) return 'gemini-2.5-flash';
  if (m.includes('sonnet')) return 'gemini-2.5-flash';
  if (m.includes('gemini')) return anthropicModel; // 直接Gemini指定もOK
  return 'gemini-2.5-flash';
}

/**
 * Anthropic messages 配列を Gemini contents 配列に変換
 * Anthropic: [{ role:'user'|'assistant', content: 'text' or [{type:'text', text:'...'}] }]
 * Gemini:    [{ role:'user'|'model',     parts: [{ text:'...' }] }]
 */
function convertMessages(anthropicMessages = []) {
  const out = [];
  for (const msg of anthropicMessages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'string') text += block;
        else if (block.type === 'text' && block.text) text += block.text;
      }
    }
    if (text) out.push({ role, parts: [{ text }] });
  }
  return out;
}

/**
 * Anthropic messages.create 互換のメイン関数
 * @param {Object} params
 * @param {string} params.model
 * @param {number} params.max_tokens
 * @param {Array} params.messages
 * @param {string} [params.system]
 * @param {Array} [params.tools]   - 'web_search_*' は Google Search grounding に変換、それ以外は無視
 * @param {number} [params.temperature]
 * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
 */
async function createWithRetry(params, maxRetries = 3) {
  if (!client) {
    throw new Error('GEMINI_API_KEY が未設定のため Gemini クライアントを初期化できません。');
  }

  const modelName = mapModel(params.model);

  // tools の解釈：'web_search_*' があれば Google Search grounding を有効化
  const wantsWebSearch = Array.isArray(params.tools) &&
    params.tools.some(t => t && typeof t.type === 'string' && t.type.startsWith('web_search'));

  const generationConfig = {
    maxOutputTokens: params.max_tokens || 1024,
    temperature: typeof params.temperature === 'number' ? params.temperature : 0.7,
  };

  const modelOpts = {
    model: modelName,
    generationConfig,
  };
  if (params.system && typeof params.system === 'string') {
    modelOpts.systemInstruction = params.system;
  }
  if (wantsWebSearch) {
    // Gemini 2.5 Flash の Google Search grounding
    modelOpts.tools = [{ googleSearch: {} }];
  }

  const model = client.getGenerativeModel(modelOpts);
  const contents = convertMessages(params.messages);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent({ contents });
      const response = result.response;

      // テキストを抽出して Anthropic互換形式に変換
      let outputText = '';
      try {
        outputText = response.text();
      } catch {
        // 一部のレスポンス形式に対応
        const candidates = response.candidates || [];
        for (const c of candidates) {
          for (const p of (c.content?.parts || [])) {
            if (p.text) outputText += p.text;
          }
        }
      }

      return {
        content: [{ type: 'text', text: outputText || '' }],
        // Anthropic互換のメタフィールドはダミーで埋める
        id: response?.usageMetadata?.requestId || `gemini-${Date.now()}`,
        model: modelName,
        role: 'assistant',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: response?.usageMetadata?.promptTokenCount || 0,
          output_tokens: response?.usageMetadata?.candidatesTokenCount || 0,
        },
      };
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const isRateLimit = status === 429 || /rate limit|quota/i.test(err?.message || '');
      if (isRateLimit && attempt < maxRetries) {
        const waitSec = Math.min(60 * (attempt + 1), 180);
        console.log(`[gemini-client] レートリミット。${waitSec}秒待機してリトライ (${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }
      // 5xx は1度だけリトライ
      if (status && status >= 500 && attempt < 1) {
        console.log(`[gemini-client] ${status}エラー。30秒待機してリトライ...`);
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('[gemini-client] 全リトライが失敗しました');
}

module.exports = { client, createWithRetry, mapModel };
