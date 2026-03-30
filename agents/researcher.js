const fs = require('fs');
const path = require('path');
const { createWithRetry } = require('../lib/anthropic-client');
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
  const response = await createWithRetry({
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
  const response = await createWithRetry({
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

// 当日ニュースかどうかを判定（published_dateが今日でないものを除外）
function isTodayNews(item, today) {
  if (!item.published_date) return true; // 日付不明は通す（保守的）
  return item.published_date.startsWith(today);
}

async function run() {
  console.log('[researcher] リサーチ開始...');

  const persona = readJSON(path.join(KNOWLEDGE_DIR, 'persona.json'), {});
  const poolPath = path.join(DATA_DIR, 'research_pool.json');
  let pool = readJSON(poolPath);

  // JSTの今日の日付を使用
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = jstNow.toISOString().split('T')[0];
  const yesterday = new Date(jstNow - 86400000).toISOString().split('T')[0];
  let newItems = [];

  // A. 国内の最新投資ニュース
  console.log('  [researcher] 国内ニュースを検索中...');
  try {
    const domesticResult = await searchWithClaude(
      `【重要】本日${today}（JST）に公開・発表されたばかりの日本の投資関連ニュースのみを検索してください。
昨日以前のニュースは絶対に含めないでください。「今日」「本日」「速報」などのキーワードで絞ってください。

対象テーマ：
- 日本株市場の本日の動向（日経平均、TOPIX、今日の終値・変動率）
- 本日発表の決算（企業名・証券コード・増減益率を含む）
- 日銀の本日の発言・政策動向
- 本日発表の日本の経済指標
- 本日のIPO・新規上場
- 半導体・AI・防衛・原子力・宇宙の本日ニュース

以下のJSON配列形式で出力してください（当日ニュースのみ）：
[
  {
    "title": "ニュースのタイトル",
    "published_date": "${today}",
    "summary": "要約（2〜3文、具体的な数字・銘柄名・証券コードを含む）",
    "investment_angle": "投資家目線での分析ポイント（なぜ今日重要か）",
    "tickers": ["7203", "6758"],
    "keywords": ["日経平均", "半導体", "決算"],
    "recommended_pattern": "P01〜P17のいずれか",
    "urgency": "high（速報・当日発表）/ medium / low"
  }
]

JSON配列のみ出力してください。古いニュースは絶対に含めないこと。`
    );

    const domesticItems = extractJSON(domesticResult);
    const todayItems = domesticItems.filter(item => isTodayNews(item, today));
    const skipped = domesticItems.length - todayItems.length;
    if (skipped > 0) console.log(`  [researcher] 当日フィルタ: ${skipped}件除外`);

    for (const item of todayItems) {
      newItems.push({
        id: `r_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        theme: item.title || 'domestic',
        title: item.title || '',
        published_date: item.published_date || today,
        summary: item.summary || '',
        investment_angle: item.investment_angle || '',
        tickers: item.tickers || [],
        keywords: item.keywords || [],
        recommended_pattern: item.recommended_pattern || 'P14',
        urgency: item.urgency || 'medium',
        source_type: 'domestic',
        created_at: new Date().toISOString(),
        used: false
      });
    }
    console.log(`  [researcher] 国内ニュース: ${todayItems.length}件収集（当日のみ）`);
  } catch (err) {
    console.error(`  [researcher] 国内ニュース検索エラー: ${err.message}`);
  }

  // レートリミット回避: 65秒待機
  await new Promise(r => setTimeout(r, 65000));

  // B. 海外の最新投資ニュース
  console.log('  [researcher] 海外ニュースを検索中...');
  try {
    const internationalResult = await searchWithClaude(
      `【重要】本日${today}（JST）/ ${yesterday}（米国時間）に発表・公開された海外投資関連ニュースのみを検索してください。
古いニュースは絶対に含めないでください。

対象テーマ：
- 米国株市場の本日の動向（S&P500・NASDAQ・NYダウの変動率・終値）
- FRBの本日の発言・政策決定
- 本日発表の米国主要企業決算（FAANG・半導体・AI企業、EPS・売上の実績vs予想）
- 地政学リスクの本日の動き（米中・中東・ウクライナ）
- 本日のグローバルテーマ投資トレンド
- 本日の暗号資産価格動向

JSON配列形式で出力（当日ニュースのみ）：
[
  {
    "title": "ニュースのタイトル",
    "published_date": "${today}",
    "summary": "要約（2〜3文、具体的な数字・ティッカーシンボルを含む）",
    "investment_angle": "投資家目線での分析ポイント",
    "tickers": ["NVDA", "AAPL"],
    "keywords": ["S&P500", "FRB", "半導体"],
    "recommended_pattern": "P01〜P17のいずれか",
    "urgency": "high / medium / low"
  }
]

JSON配列のみ出力してください。`
    );

    const intlItems = extractJSON(internationalResult);
    const todayIntlItems = intlItems.filter(item => isTodayNews(item, today));
    const skippedIntl = intlItems.length - todayIntlItems.length;
    if (skippedIntl > 0) console.log(`  [researcher] 当日フィルタ（海外）: ${skippedIntl}件除外`);

    for (const item of todayIntlItems) {
      newItems.push({
        id: `r_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        theme: item.title || 'international',
        title: item.title || '',
        published_date: item.published_date || today,
        summary: item.summary || '',
        investment_angle: item.investment_angle || '',
        tickers: item.tickers || [],
        keywords: item.keywords || [],
        recommended_pattern: item.recommended_pattern || 'P14',
        urgency: item.urgency || 'medium',
        source_type: 'international',
        created_at: new Date().toISOString(),
        used: false
      });
    }
    console.log(`  [researcher] 海外ニュース: ${todayIntlItems.length}件収集（当日のみ）`);
  } catch (err) {
    console.error(`  [researcher] 海外ニュース検索エラー: ${err.message}`);
  }

  // レートリミット回避: 65秒待機
  await new Promise(r => setTimeout(r, 65000));

  // C. Xでバズっている投資系の話題（今日の話題に絞る）
  console.log('  [researcher] Xトレンドを検索中...');
  try {
    const trendingResult = await searchWithClaude(
      `本日${today}、X（Twitter）の日本語の投資クラスタで話題になっていること・バズっていることを検索してください。
今日の相場に関連した話題、本日の決算・ニュースへの反応、今日トレンドの銘柄やテーマを5個挙げてください。
昨日以前の古い話題は除外してください。

JSON配列形式で出力：
[
  {
    "title": "話題のタイトル",
    "published_date": "${today}",
    "summary": "どんな議論がされているか（2〜3文）",
    "investment_angle": "この話題を投稿に活かすポイント",
    "tickers": ["7203"],
    "keywords": ["半導体", "決算"],
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
        published_date: item.published_date || today,
        summary: item.summary || '',
        investment_angle: item.investment_angle || '',
        tickers: item.tickers || [],
        keywords: item.keywords || [],
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

// 軽量版：バズツイート候補収集のみ（昼モード用・API1回で完結）
async function runBuzzOnly() {
  console.log('[researcher] バズツイート候補収集（軽量）...');
  const today = new Date().toISOString().split('T')[0];
  const candidatesPath = path.join(DATA_DIR, 'retweet_candidates.json');
  const rtHistoryPath = path.join(DATA_DIR, 'retweet_history.json');
  const existingCandidates = readJSON(candidatesPath);
  const rtHistory = readJSON(rtHistoryPath);

  const usedIds = new Set([
    ...existingCandidates.map(c => c.tweet_id),
    ...rtHistory.map(r => r.quoted_tweet_id)
  ]);

  try {
    const found = await searchBuzzTweets(
      `今日（${today}）の日本語投資Xアカウントでバズっているツイートを検索してください。
      いいね・RTが多い投資系ツイートのURLと内容を5件教えてください。`
    );

    const newCandidates = [];
    for (const [tweetId, context] of found) {
      if (!usedIds.has(tweetId) && newCandidates.length < 5) {
        newCandidates.push({ tweet_id: tweetId, context: context.substring(0, 200), found_at: new Date().toISOString() });
      }
    }

    const merged = [...existingCandidates, ...newCandidates].slice(0, 10);
    writeJSON(candidatesPath, merged);
    console.log(`[researcher] バズツイート${newCandidates.length}件追加、合計${merged.length}件`);
  } catch (err) {
    console.error(`[researcher] バズツイート収集エラー: ${err.message}`);
  }
}

module.exports = { run, runBuzzOnly };

if (require.main === module) {
  run().catch(console.error);
}
