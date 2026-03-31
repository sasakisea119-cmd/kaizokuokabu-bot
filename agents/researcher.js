const fs = require('fs');
const path = require('path');
const grok = require('../lib/grok-client');
const { createWithRetry } = require('../lib/anthropic-client');
const DATA_DIR = path.join(__dirname, '..', 'data');
const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');

// コスト戦略:
// - Grok x_search ($0.20/Mトークン): Xトレンド検索、バズツイート収集
// - Claude web_search ($3.00/Mトークン): ニュース収集（Xに出ないニュースはClaude）
// - Grokを使えない場合のフォールバック: Claude web_search

function readJSON(filePath, fallback = []) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function extractJSON(text) {
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
    const m2 = text.match(/\{[\s\S]*\}/);
    if (m2) return [JSON.parse(m2[0])];
  } catch {}
  return [];
}

const hasGrok = () => !!process.env.XAI_API_KEY;

// Claude web_search（Grok使えない場合のフォールバック）
async function searchWithClaude(prompt) {
  const response = await createWithRetry({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }]
  });
  return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

function buildItem(item, sourceType, today) {
  return {
    id: `r_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    theme: item.title || sourceType,
    title: item.title || '',
    published_date: item.published_date || today,
    summary: item.summary || '',
    investment_angle: item.investment_angle || '',
    tickers: item.tickers || [],
    keywords: item.keywords || [],
    recommended_pattern: item.recommended_pattern || 'P14',
    urgency: item.urgency || 'medium',
    source_type: sourceType,
    created_at: new Date().toISOString(),
    used: false
  };
}

async function run() {
  console.log(`[researcher] リサーチ開始... (エンジン: ${hasGrok() ? 'Grok x_search + Claude' : 'Claude only'})`);

  const poolPath = path.join(DATA_DIR, 'research_pool.json');
  let pool = readJSON(poolPath);
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = jstNow.toISOString().split('T')[0];
  let newItems = [];

  // ===== A. 国内ニュース（Claude web_search — ニュースサイト検索はClaudeが得意） =====
  console.log('  [researcher] 国内ニュースを検索中（Claude web_search）...');
  try {
    const result = await searchWithClaude(
      `【重要】本日${today}（JST）に公開されたばかりの日本の投資関連ニュースのみを検索。
昨日以前は絶対に含めない。

対象：日経平均・TOPIX動向、本日の決算発表、日銀政策、経済指標、IPO、半導体・AI・防衛

JSON配列で出力：
[{"title":"","published_date":"${today}","summary":"数字・証券コード含む","investment_angle":"","tickers":["7203"],"keywords":["日経平均"],"recommended_pattern":"P01","urgency":"high/medium/low"}]
JSON配列のみ出力。`
    );
    const items = extractJSON(result).filter(i => !i.published_date || i.published_date.startsWith(today));
    items.forEach(i => newItems.push(buildItem(i, 'domestic', today)));
    console.log(`  [researcher] 国内ニュース: ${items.length}件`);
  } catch (err) {
    console.error(`  [researcher] 国内ニュース検索エラー: ${err.message}`);
  }

  await new Promise(r => setTimeout(r, 30000));

  // ===== B. Xトレンド（Grok x_search — X検索はGrokが圧倒的に強い＆安い） =====
  console.log('  [researcher] Xトレンドを検索中（Grok x_search）...');
  try {
    if (hasGrok()) {
      // Grok: 日本株市場トレンド
      const marketResult = await grok.searchX(grok.TEMPLATES.market_trend(12), 12);
      const trendItems = extractJSON(marketResult);
      if (trendItems.length === 0) {
        // Grokの結果がJSONでない場合、テキストからネタを抽出
        const lines = marketResult.split('\n').filter(l => l.trim().length > 20);
        for (const line of lines.slice(0, 5)) {
          newItems.push(buildItem({
            title: line.substring(0, 60).trim(),
            summary: line.trim(),
            urgency: 'medium'
          }, 'trending_x', today));
        }
      } else {
        trendItems.forEach(i => newItems.push(buildItem(i, 'trending_x', today)));
      }

      // Grok: 米国市場影響
      await new Promise(r => setTimeout(r, 5000));
      const usResult = await grok.searchX(grok.TEMPLATES.us_market_impact(12), 12);
      const usItems = extractJSON(usResult);
      if (usItems.length > 0) {
        usItems.forEach(i => newItems.push(buildItem(i, 'international_x', today)));
      }

      // Grok: セクター別（半導体・AI）
      await new Promise(r => setTimeout(r, 5000));
      const sectorResult = await grok.searchX(grok.TEMPLATES.sector_theme('半導体 AI'), 12);
      const sectorItems = extractJSON(sectorResult);
      if (sectorItems.length > 0) {
        sectorItems.forEach(i => newItems.push(buildItem(i, 'sector_x', today)));
      }

      console.log(`  [researcher] Xトレンド（Grok）: ${newItems.filter(i => i.source_type.includes('_x')).length}件`);
    } else {
      // フォールバック: Claude web_search
      const result = await searchWithClaude(
        `本日${today}のX投資クラスタでバズっている話題5件をJSON配列で出力：
[{"title":"","published_date":"${today}","summary":"","investment_angle":"","tickers":[],"keywords":[],"recommended_pattern":"P11","urgency":"medium"}]`
      );
      extractJSON(result).forEach(i => newItems.push(buildItem(i, 'trending', today)));
      console.log(`  [researcher] Xトレンド（Claude fallback）: ${extractJSON(result).length}件`);
    }
  } catch (err) {
    console.error(`  [researcher] Xトレンド検索エラー: ${err.message}`);
  }

  await new Promise(r => setTimeout(r, 10000));

  // ===== C. バズツイート候補収集（Grok x_search — 引用RT用） =====
  console.log('  [researcher] バズツイートを検索中...');
  try {
    const candidatesPath = path.join(DATA_DIR, 'retweet_candidates.json');
    const rtHistoryPath = path.join(DATA_DIR, 'retweet_history.json');
    const existing = readJSON(candidatesPath);
    const rtHistory = readJSON(rtHistoryPath);
    const usedIds = new Set([...existing.map(c => c.tweet_id), ...rtHistory.map(r => r.quoted_tweet_id)]);

    let found = new Map();
    if (hasGrok()) {
      found = await grok.searchBuzzTweets(grok.TEMPLATES.buzz_investment(6), 6);
    } else {
      // Claude fallback
      const response = await createWithRetry({
        model: 'claude-sonnet-4-20250514', max_tokens: 4096,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: `今日の日本語投資系バズツイートのURLを5件検索してください。` }]
      });
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const re = /https?:\/\/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/g;
      let m; while ((m = re.exec(text)) !== null) { if (!found.has(m[1])) found.set(m[1], text.substring(Math.max(0, m.index - 80), m.index + 100)); }
    }

    const newCandidates = [];
    for (const [id, ctx] of found) {
      if (!usedIds.has(id) && newCandidates.length < 10) {
        newCandidates.push({ tweet_id: id, context: ctx.substring(0, 200), found_at: new Date().toISOString() });
      }
    }
    const merged = [...existing, ...newCandidates].slice(0, 10);
    writeJSON(candidatesPath, merged);
    console.log(`  [researcher] バズツイート: ${newCandidates.length}件追加、合計${merged.length}件`);
  } catch (err) {
    console.error(`  [researcher] バズツイート検索エラー: ${err.message}`);
  }

  // プールに追加
  pool = [...pool, ...newItems];
  writeJSON(poolPath, pool);

  const highUrgency = newItems.filter(i => i.urgency === 'high');
  if (highUrgency.length > 0) {
    console.log(`  [researcher] 🔥 速報ネタ ${highUrgency.length}件あり！`);
    highUrgency.forEach(i => console.log(`    - ${i.title}`));
  }

  console.log(`[researcher] 完了: ${newItems.length}件追加、プール合計: ${pool.length}件`);
}

// 軽量版：バズツイート候補収集のみ（昼モード用・Grok1回で完結）
async function runBuzzOnly() {
  console.log(`[researcher] バズツイート候補収集（軽量 / ${hasGrok() ? 'Grok' : 'Claude'}）...`);
  const candidatesPath = path.join(DATA_DIR, 'retweet_candidates.json');
  const rtHistoryPath = path.join(DATA_DIR, 'retweet_history.json');
  const existing = readJSON(candidatesPath);
  const rtHistory = readJSON(rtHistoryPath);
  const usedIds = new Set([...existing.map(c => c.tweet_id), ...rtHistory.map(r => r.quoted_tweet_id)]);

  try {
    let found = new Map();
    if (hasGrok()) {
      found = await grok.searchBuzzTweets(grok.TEMPLATES.buzz_investment(6), 6);
    } else {
      const result = await searchWithClaude(`今日の日本語投資系バズツイートのURLを5件教えてください。`);
      const re = /https?:\/\/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/g;
      let m; while ((m = re.exec(result)) !== null) { if (!found.has(m[1])) found.set(m[1], result.substring(Math.max(0, m.index - 80), m.index + 100)); }
    }

    const newCandidates = [];
    for (const [id, ctx] of found) {
      if (!usedIds.has(id) && newCandidates.length < 5) {
        newCandidates.push({ tweet_id: id, context: ctx.substring(0, 200), found_at: new Date().toISOString() });
      }
    }
    const merged = [...existing, ...newCandidates].slice(0, 10);
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
