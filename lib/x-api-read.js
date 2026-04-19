/**
 * X API 読み取り系ラッパー
 * - ユーザータイムライン取得（インターセプトBot用）
 * - ユーザーID解決
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const crypto = require('crypto');
const https = require('https');

const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function generateOAuthSignature(method, url, params, tokenSecret) {
  const sortedParams = Object.keys(params).sort().map(k =>
    `${percentEncode(k)}=${percentEncode(params[k])}`
  ).join('&');

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams)
  ].join('&');

  const signingKey = `${percentEncode(API_SECRET)}&${percentEncode(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildAuthHeader(method, url, queryParams = {}) {
  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: crypto.randomBytes(32).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0'
  };

  const allParams = { ...oauthParams, ...queryParams };
  const signature = generateOAuthSignature(method, url, allParams, ACCESS_TOKEN_SECRET);
  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams).sort().map(k =>
    `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`
  );
  return `OAuth ${headerParts.join(', ')}`;
}

function makeRequest(method, url, queryParams = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    for (const [k, v] of Object.entries(queryParams)) {
      urlObj.searchParams.set(k, v);
    }

    const authHeader = buildAuthHeader(method, url, queryParams);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'kaizokuokabu-bot/1.0'
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * ユーザー名（@なし）からuser_idを取得
 */
async function getUserIdByUsername(username) {
  const cleanName = username.replace(/^@/, '');
  const url = `https://api.x.com/2/users/by/username/${cleanName}`;
  const result = await makeRequest('GET', url);

  if (result.status === 200 && result.data?.data?.id) {
    return { id: result.data.data.id, username: result.data.data.username, name: result.data.data.name };
  }

  console.error(`[getUserIdByUsername] 取得失敗 (@${cleanName}):`, result.status, JSON.stringify(result.data).slice(0, 200));
  return null;
}

/**
 * ユーザーの最新ツイート取得
 * @param {string} userId
 * @param {Object} opts
 * @param {number} opts.max_results — 取得件数（5-100、デフォルト5）
 * @param {string} opts.since_id — このIDより新しいツイートのみ
 */
async function getUserTimeline(userId, opts = {}) {
  const url = `https://api.x.com/2/users/${userId}/tweets`;
  const queryParams = {
    'max_results': String(opts.max_results || 5),
    'tweet.fields': 'created_at,public_metrics,referenced_tweets,in_reply_to_user_id',
    'exclude': 'replies,retweets'
  };
  if (opts.since_id) queryParams.since_id = opts.since_id;

  const result = await makeRequest('GET', url, queryParams);

  if (result.status === 200) {
    return result.data.data || [];
  }

  // レートリミット情報をログ
  if (result.status === 429) {
    const reset = result.headers['x-rate-limit-reset'];
    const resetDate = reset ? new Date(parseInt(reset) * 1000).toISOString() : 'unknown';
    console.error(`[getUserTimeline] 429 rate limit. reset=${resetDate}`);
  } else {
    console.error(`[getUserTimeline] ${result.status}:`, JSON.stringify(result.data).slice(0, 200));
  }
  return null;
}

module.exports = { getUserIdByUsername, getUserTimeline };
