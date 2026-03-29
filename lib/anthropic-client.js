/**
 * Anthropic API共通クライアント（レートリミット自動リトライ付き）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * messages.create のリトライラッパー
 * 429エラー時は retry-after ヘッダーの秒数待ってリトライ（最大3回）
 */
async function createWithRetry(params, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      if (err.status === 429 && attempt < maxRetries) {
        // retry-after ヘッダーから待機秒数を取得（なければ60秒）
        const retryAfter = parseInt(err.headers?.['retry-after'] || '60', 10);
        const waitSec = Math.min(retryAfter + 5, 180); // 最大3分
        console.log(`[anthropic] 429 レートリミット。${waitSec}秒待機してリトライ (${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      } else {
        throw err;
      }
    }
  }
}

module.exports = { client, createWithRetry };
