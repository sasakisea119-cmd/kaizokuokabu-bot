require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const crypto = require('crypto');
const https = require('https');

const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

// RFC 3986準拠のパーセントエンコーディング
function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

// OAuth 1.0a署名を生成
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

// Authorizationヘッダーを構築
function buildAuthHeader(method, url, queryParams = {}) {
  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: crypto.randomBytes(32).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0'
  };

  // 署名にはOAuthパラメータ + クエリパラメータを含める（JSON bodyは含めない）
  const allParams = { ...oauthParams, ...queryParams };
  const signature = generateOAuthSignature(method, url, allParams, ACCESS_TOKEN_SECRET);
  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams).sort().map(k =>
    `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`
  );
  return `OAuth ${headerParts.join(', ')}`;
}

// HTTPSリクエスト実行
function makeRequest(method, url, body = null, queryParams = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    // クエリパラメータをURLに追加
    for (const [k, v] of Object.entries(queryParams)) {
      urlObj.searchParams.set(k, v);
    }

    const authHeader = buildAuthHeader(method, url, queryParams);

    const headers = {
      'Authorization': authHeader,
      'User-Agent': 'kaizokuokabu-bot/1.0'
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ツイートを投稿
async function postTweet(text) {
  try {
    const url = 'https://api.x.com/2/tweets';
    const result = await makeRequest('POST', url, { text });

    if (result.status === 201 || result.status === 200) {
      const tweet = result.data.data;
      console.log(`[postTweet] 投稿成功: ${tweet.id}`);
      return { id: tweet.id, text: tweet.text };
    }

    handleApiError(result, 'postTweet');
    return null;
  } catch (err) {
    console.error(`[postTweet] エラー: ${err.message}`);
    return null;
  }
}

// 引用リツイート
async function quoteTweet(text, quoteTweetId) {
  try {
    const url = 'https://api.x.com/2/tweets';
    const result = await makeRequest('POST', url, { text, quote_tweet_id: quoteTweetId });

    if (result.status === 201 || result.status === 200) {
      const tweet = result.data.data;
      console.log(`[quoteTweet] 引用RT成功: ${tweet.id}`);
      return { id: tweet.id, text: tweet.text };
    }

    handleApiError(result, 'quoteTweet');
    return null;
  } catch (err) {
    console.error(`[quoteTweet] エラー: ${err.message}`);
    return null;
  }
}

// メトリクス取得
async function getTweetMetrics(tweetId) {
  try {
    const url = `https://api.x.com/2/tweets/${tweetId}`;
    const queryParams = { 'tweet.fields': 'public_metrics' };
    const result = await makeRequest('GET', url, null, queryParams);

    if (result.status === 200 && result.data.data) {
      const m = result.data.data.public_metrics;
      return {
        impressions: m.impression_count || 0,
        likes: m.like_count || 0,
        retweets: m.retweet_count || 0,
        replies: m.reply_count || 0
      };
    }

    handleApiError(result, 'getTweetMetrics');
    return null;
  } catch (err) {
    console.error(`[getTweetMetrics] エラー: ${err.message}`);
    return null;
  }
}

// multipart/form-data形式のHTTPSリクエスト（メディアアップロード用）
function makeFormRequest(method, url, formParams = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    // メディアアップロードではbodyパラメータをOAuth署名に含めない（Twitter仕様: multipart/form-data）
    const authHeader = buildAuthHeader(method, url, {});

    const boundary = `----boundary${crypto.randomBytes(16).toString('hex')}`;
    let bodyParts = [];
    for (const [key, value] of Object.entries(formParams)) {
      bodyParts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
        `${value}\r\n`
      );
    }
    bodyParts.push(`--${boundary}--\r\n`);
    const bodyString = bodyParts.join('');

    const headers = {
      'Authorization': authHeader,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(bodyString),
      'User-Agent': 'kaizokuokabu-bot/1.0'
    };

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.write(bodyString);
    req.end();
  });
}

// 画像をアップロードしてmedia_id_stringを返す
async function uploadMedia(base64Data) {
  try {
    const url = 'https://upload.twitter.com/1.1/media/upload.json';
    const result = await makeFormRequest('POST', url, { media_data: base64Data });

    if (result.status === 200 && result.data.media_id_string) {
      console.log(`[uploadMedia] アップロード成功: ${result.data.media_id_string}`);
      return result.data.media_id_string;
    }

    handleApiError(result, 'uploadMedia');
    return null;
  } catch (err) {
    console.error(`[uploadMedia] エラー: ${err.message}`);
    return null;
  }
}

// 画像付きツイートを投稿
async function postTweetWithMedia(text, mediaIds) {
  try {
    const url = 'https://api.x.com/2/tweets';
    const body = { text, media: { media_ids: Array.isArray(mediaIds) ? mediaIds : [mediaIds] } };
    const result = await makeRequest('POST', url, body);

    if (result.status === 201 || result.status === 200) {
      const tweet = result.data.data;
      console.log(`[postTweetWithMedia] 画像付き投稿成功: ${tweet.id}`);
      return { id: tweet.id, text: tweet.text };
    }

    handleApiError(result, 'postTweetWithMedia');
    return null;
  } catch (err) {
    console.error(`[postTweetWithMedia] エラー: ${err.message}`);
    return null;
  }
}

// APIエラーハンドリング
function handleApiError(result, context) {
  const status = result.status;
  const detail = JSON.stringify(result.data);

  if (status === 401) {
    console.error(`[${context}] 401: APIキーを確認してください. ${detail}`);
  } else if (status === 403) {
    console.error(`[${context}] 403: Read and write権限を確認してください. ${detail}`);
  } else if (status === 429) {
    console.error(`[${context}] 429: レートリミットに達しました. ${detail}`);
  } else if (status === 409 || (result.data?.errors?.[0]?.code === 187)) {
    console.error(`[${context}] 重複投稿: 同じ内容の投稿が既にあります. ${detail}`);
  } else {
    console.error(`[${context}] HTTP ${status}: ${detail}`);
  }
}

module.exports = { postTweet, quoteTweet, getTweetMetrics, uploadMedia, postTweetWithMedia };
