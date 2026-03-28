require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

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

// Anthropic APIでWeb検索を使ってリサーチ
async function searchWithClaude(prompt) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }]
  });

  // textブロックを結合して返す
  const textBlocks = response.content.filter(b => b.type === 'text');
  return textBlocks.map(b => b.text).join('\n');
}

// Web検索結果からツイートURLを抽出する版
async function searchBuzzTweets(prompt) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }]
  });

  const tweetUrlPattern = /https?:\/\/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/g;
  const foundTweets = new Map(); // tweet_id -> context

  // 全contentブロックからURLを抽出
  for (const block of response.content) {
    let textToSearch = '';

    if (block.type === 'text') {
      textToSearch = block.text;
    } else if (block.type === 'web_search_tool_result' && block.content) {
      // 検索結果ブロックからURLとスニペットを抽出
      for (const result of block.content) {
        if (result.type === 'web_search_result') {
          const url = result.url || '';
          const match = url.match(/https?:\/\/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/);
          if (match) {
            foundTweets.set(match[1], (result.title || '') + ' ' + (result.snippet || ''));
          }
          // スニペット内にもURLがある可能性
          textToSearch += (result.snippet || '') + ' ' + url + ' ';
        }
      }
    }

    // テキストからもURL抽出
    let urlMatch;
    while ((urlMatch = tweetUrlPattern.exec(textToSearch)) !== null) {
      if (!foundTweets.has(urlMatch[1])) {
        // 前後の文脈を取得
        const start = Math.max(0, urlMatch.index - 100);
        const end = Math.min(textToSearch.length, urlMatch.index + urlMatch[0].length + 100);
        foundTweets.set(urlMatch[1], textToSearch.substring(start, end).trim());
      }
    }
  }

  return foundTweets;
}

// レスポンスからJSONを抽出
function extractJSON(text) {
  try {
    // JSON配列を探す
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) return JSON.parse(arrayMatch[0]);

    // JSONオブジェクトを探す
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) return [JSON.parse(objMatch[0])];
  } catch {
    // パースできない場合は空
  }
  return [];
}

async function run() {
  console.log('[researcher] リサーチ開始...');

  const persona = readJSON(path.join(KNOWLEDGE_DIR, 'persona.json'), {});
  const poolPath = path.join(DATA_DIR, 'research_pool.json');
  let pool = readJSON(poolPath);

  const today = new Date().toISOString().split('T')[0];
  let newItems = [];

  // A. 国内の最新投資ニュース
  console.log('  [researcher] 国内ニュースを検索中...');
  try {
    const domesticResult = await searchWithClaude(
      `今日（${today}）の日本の投資関連ニュースを検索して、以下のテーマについて情報を収集してください：
- 日本株市場の動向（日経平均、TOPIX）
- 注目の決算発表
- 日銀の金融政策
- 日本の経済指標
- 注目のIPO
- テーマ投資（半導体、AI、防衛、原子力、宇宙）の国内動向

各ニュースについて以下のJSON配列形式で出力してください：
[
  {
    "title": "ニュースのタイトル",
    "summary": "要約（2〜3文）",
    "investment_angle": "投資家目線での分析ポイント",
    "recommended_pattern": "P01〜P17のいずれか",
    "urgency": "high / medium / low"
  }
]

JSON配列のみ出力してください。`
    );

    const domesticItems = extractJSON(domesticResult);
    for (const item of domesticItems) {
      newItems.push({
        id: `r_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        theme: item.title || 'domestic',
        title: item.title || '',
        summary: item.summary || '',
        investment_angle: item.investment_angle || '',
        recommended_pattern: item.recommended_pattern || 'P14',
        urgency: item.urgency || 'medium',
        source_type: 'domestic',
        created_at: new Date().toISOString(),
        used: false
      });
    }
    console.log(`  [researcher] 国内ニュース: ${domesticItems.length}件収集`);
  } catch (err) {
    console.error(`  [researcher] 国内ニュース検索エラー: ${err.message}`);
  }

  // レートリミット回避: 65秒待機
  await new Promise(r => setTimeout(r, 65000));

  // B. 海外の最新投資ニュース
  console.log('  [researcher] 海外ニュースを検索中...');
  try {
    const internationalResult = await searchWithClaude(
      `今日（${today}）の海外投資関連ニュースを検索して収集してください：
- 米国株市場（S&P500, NASDAQ）の動向
- FRBの金融政策
- 米国の主要企業決算（FAANG, 半導体等）
- 地政学リスク（米中関係、中東等の市場影響）
- グローバルなテーマ投資トレンド
- 暗号資産・新興市場の動向

JSON配列形式で出力：
[
  {
    "title": "ニュースのタイトル",
    "summary": "要約（2〜3文）",
    "investment_angle": "投資家目線での分析ポイント",
    "recommended_pattern": "P01〜P17のいずれか",
    "urgency": "high / medium / low"
  }
]

JSON配列のみ出力してください。`
    );

    const intlItems = extractJSON(internationalResult);
    for (const item of intlItems) {
      newItems.push({
        id: `r_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        theme: item.title || 'international',
        title: item.title || '',
        summary: item.summary || '',
        investment_angle: item.investment_angle || '',
        recommended_pattern: item.recommended_pattern || 'P14',
        urgency: item.urgency || 'medium',
        source_type: 'international',
        created_at: new Date().toISOString(),
        used: false
      });
    }
    console.log(`  [researcher] 海外ニュース: ${intlItems.length}件収集`);
  } catch (err) {
    console.error(`  [researcher] 海外ニュース検索エラー: ${err.message}`);
  }

  // レートリミット回避: 65秒待機
  await new Promise(r => setTimeout(r, 65000));

  // C. Xでバズっている投資系の話題
  console.log('  [researcher] Xトレンドを検索中...');
  try {
    const trendingResult = await searchWithClaude(
      `X（Twitter）の日本語の投資クラスタで今バズっている話題、トレンドになっている銘柄やテーマを検索してください。
日本語の投資系ツイートで話題になっていること、議論になっていることを5個挙げてください。

JSON配列形式で出力：
[
  {
    "title": "話題のタイトル",
    "summary": "どんな議論がされているか（2〜3文）",
    "investment_angle": "この話題を投稿に活かすポイント",
    "recommended_pattern": "P08やP11など適切なパターン",
    "urgency": "high / medium / low"
  }
]

JSON配列のみ出力してください。`
    );

    const trendItems = extractJSON(trendingResult);
    for (const item of trendItems) {
      newItems.push({
        id: `r_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        theme: item.title || 'trending',
        title: item.title || '',
        summary: item.summary || '',
        investment_angle: item.investment_angle || '',
        recommended_pattern: item.recommended_pattern || 'P11',
        urgency: item.urgency || 'medium',
        source_type: 'trending',
        created_at: new Date().toISOString(),
        used: false
      });
    }
    console.log(`  [researcher] Xトレンド: ${trendItems.length}件収集`);
  } catch (err) {
    console.error(`  [researcher] Xトレンド検索エラー: ${err.message}`);
  }

  // レートリミット回避: 65秒待機
  await new Promise(r => setTimeout(r, 65000));

  // D. バズツイートURL収集（引用RT候補の自動取得）
  console.log('  [researcher] バズツイートを検索中...');
  try {
    const candidatesPath = path.join(DATA_DIR, 'retweet_candidates.json');
    const rtHistoryPath = path.join(DATA_DIR, 'retweet_history.json');
    const existingCandidates = readJSON(candidatesPath);
    const rtHistory = readJSON(rtHistoryPath);

    // 既存IDをセットにして重複排除用
    const usedIds = new Set([
      ...existingCandidates.map(c => c.tweet_id),
      ...rtHistory.map(r => r.quoted_tweet_id)
    ]);

    const allFoundTweets = new Map();

    // 複数クエリで検索して網を広げる
    const searchQueries = [
      `site:x.com 日本株 投資 バズ ${today}`,
      `site:x.com 米国株 決算 半導体 2024 2025`,
      `site:x.com 投資家 注目 いいね`
    ];

    for (const query of searchQueries) {
      try {
        const found = await searchBuzzTweets(
          `以下の検索クエリでバズっている投資系ツイートを探してください。ツイートのURLを必ず含めて報告してください。

検索: ${query}

各ツイートについて、URLと内容の要約を教えてください。`
        );
        for (const [id, context] of found) {
          if (!usedIds.has(id) && !allFoundTweets.has(id)) {
            allFoundTweets.set(id, context);
          }
        }
      } catch (err) {
        console.error(`  [researcher] クエリ「${query}」エラー: ${err.message}`);
      }
    }

    // 最大10件に制限して候補に追加
    const newCandidates = [];
    for (const [tweetId, context] of allFoundTweets) {
      if (newCandidates.length >= 10) break;
      newCandidates.push({
        tweet_id: tweetId,
        context: context.substring(0, 200),
        found_at: new Date().toISOString()
      });
    }

    // 既存候補に追加（合計最大10件）
    const merged = [...existingCandidates, ...newCandidates].slice(0, 10);
    writeJSON(candidatesPath, merged);

    console.log(`  [researcher] バズツイート: ${newCandidates.length}件発見、候補合計: ${merged.length}件`);
  } catch (err) {
    console.error(`  [researcher] バズツイート検索エラー: ${err.message}`);
  }

  // プールに追加
  pool = [...pool, ...newItems];
  writeJSON(poolPath, pool);

  // urgency=highのネタがあれば通知
  const highUrgency = newItems.filter(i => i.urgency === 'high');
  if (highUrgency.length > 0) {
    console.log(`  [researcher] \u{1F525} 速報ネタ ${highUrgency.length}件あり！`);
    for (const item of highUrgency) {
      console.log(`    - ${item.title}`);
    }
  }

  console.log(`[researcher] 完了: ${newItems.length}件追加、プール合計: ${pool.length}件`);
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
