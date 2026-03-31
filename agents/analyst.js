const fs = require('fs');
const path = require('path');
const { createWithRetry } = require('../lib/anthropic-client');
const DATA_DIR = path.join(__dirname, '..', 'data');

function readJSON(filePath, fallback = []) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// A/Bテスト: 各ディメンションのパフォーマンスを集計
function runABAnalysis(withMetrics) {
  const dimensions = {
    tweet_type: {},     // standard / short_personal / contrarian / note_cta
    post_length: {},    // short(<100) / medium(100-200) / long(200+)
    hour_bucket: {},    // morning(5-11) / noon(11-17) / evening(17-23) / night(23-5)
    has_cashtag: {},    // true / false
    pattern_id: {},
    theme: {},
  };

  for (const post of withMetrics) {
    const imp = post.metrics?.impressions || 0;
    const likes = post.metrics?.likes || 0;
    const rts = post.metrics?.retweets || 0;
    const engagement = likes + rts;

    // tweet_type
    const ttype = post.tweet_type || 'standard';
    if (!dimensions.tweet_type[ttype]) dimensions.tweet_type[ttype] = { count: 0, total_imp: 0, total_eng: 0 };
    dimensions.tweet_type[ttype].count++;
    dimensions.tweet_type[ttype].total_imp += imp;
    dimensions.tweet_type[ttype].total_eng += engagement;

    // post_length
    const len = (post.text || '').length;
    const lenBucket = len < 100 ? 'short' : len < 200 ? 'medium' : 'long';
    if (!dimensions.post_length[lenBucket]) dimensions.post_length[lenBucket] = { count: 0, total_imp: 0, total_eng: 0 };
    dimensions.post_length[lenBucket].count++;
    dimensions.post_length[lenBucket].total_imp += imp;
    dimensions.post_length[lenBucket].total_eng += engagement;

    // hour_bucket
    const hour = new Date(post.posted_at).getUTCHours();
    const jstHour = (hour + 9) % 24;
    const hBucket = jstHour >= 5 && jstHour < 11 ? 'morning' : jstHour >= 11 && jstHour < 17 ? 'noon' : jstHour >= 17 && jstHour < 23 ? 'evening' : 'night';
    if (!dimensions.hour_bucket[hBucket]) dimensions.hour_bucket[hBucket] = { count: 0, total_imp: 0, total_eng: 0 };
    dimensions.hour_bucket[hBucket].count++;
    dimensions.hour_bucket[hBucket].total_imp += imp;
    dimensions.hour_bucket[hBucket].total_eng += engagement;

    // has_cashtag
    const hasCash = /\$[A-Z0-9]{1,6}/.test(post.text || '') ? 'true' : 'false';
    if (!dimensions.has_cashtag[hasCash]) dimensions.has_cashtag[hasCash] = { count: 0, total_imp: 0, total_eng: 0 };
    dimensions.has_cashtag[hasCash].count++;
    dimensions.has_cashtag[hasCash].total_imp += imp;
    dimensions.has_cashtag[hasCash].total_eng += engagement;

    // pattern_id
    const pid = post.pattern_id || 'unknown';
    if (!dimensions.pattern_id[pid]) dimensions.pattern_id[pid] = { count: 0, total_imp: 0, total_eng: 0 };
    dimensions.pattern_id[pid].count++;
    dimensions.pattern_id[pid].total_imp += imp;
    dimensions.pattern_id[pid].total_eng += engagement;

    // theme
    const theme = post.theme || 'unknown';
    if (!dimensions.theme[theme]) dimensions.theme[theme] = { count: 0, total_imp: 0, total_eng: 0 };
    dimensions.theme[theme].count++;
    dimensions.theme[theme].total_imp += imp;
    dimensions.theme[theme].total_eng += engagement;
  }

  // 平均値計算
  const results = {};
  for (const [dim, buckets] of Object.entries(dimensions)) {
    results[dim] = {};
    for (const [bucket, data] of Object.entries(buckets)) {
      results[dim][bucket] = {
        count: data.count,
        avg_impressions: Math.round(data.total_imp / data.count),
        avg_engagement: Math.round(data.total_eng / data.count),
      };
    }
  }

  return results;
}

// A/Bテスト結果からwriter向けの推奨設定を自動生成
function generateABRecommendations(abResults) {
  const recs = [];

  // tweet_type: 最高平均インプのタイプを推奨
  const types = Object.entries(abResults.tweet_type || {});
  if (types.length > 1) {
    types.sort((a, b) => b[1].avg_impressions - a[1].avg_impressions);
    const best = types[0];
    const worst = types[types.length - 1];
    recs.push(`ツイートタイプ「${best[0]}」が最高インプ（平均${best[1].avg_impressions}）。「${worst[0]}」は低調（平均${worst[1].avg_impressions}）→ ${best[0]}の比率を上げる`);
  }

  // post_length: 最適な長さ
  const lengths = Object.entries(abResults.post_length || {});
  if (lengths.length > 1) {
    lengths.sort((a, b) => b[1].avg_impressions - a[1].avg_impressions);
    recs.push(`投稿の長さ「${lengths[0][0]}」が最もインプが高い（平均${lengths[0][1].avg_impressions}）`);
  }

  // hour_bucket: 最適時間帯
  const hours = Object.entries(abResults.hour_bucket || {});
  if (hours.length > 1) {
    hours.sort((a, b) => b[1].avg_impressions - a[1].avg_impressions);
    recs.push(`時間帯「${hours[0][0]}」のインプが最高（平均${hours[0][1].avg_impressions}）。投稿をこの時間帯に集中させる`);
  }

  // has_cashtag
  const cash = abResults.has_cashtag || {};
  if (cash['true'] && cash['false']) {
    const diff = cash['true'].avg_impressions - cash['false'].avg_impressions;
    if (diff > 0) {
      recs.push(`キャッシュタグ付き投稿はインプ+${diff}。積極的に$ティッカーを使う`);
    } else {
      recs.push(`キャッシュタグの効果は限定的（差${diff}）。自然な使い方を心がける`);
    }
  }

  return recs;
}

async function run() {
  console.log('[analyst] パフォーマンス分析開始...');

  const history = readJSON(path.join(DATA_DIR, 'post_history.json'));
  const withMetrics = history.filter(h => h.metrics);

  if (withMetrics.length < 10) {
    console.log(`[analyst] メトリクス取得済み${withMetrics.length}件（10件未満）。分析スキップ。`);
    return;
  }

  console.log(`[analyst] ${withMetrics.length}件を分析中...`);

  // ===== A/Bテスト分析（ローカル・API不要） =====
  const abResults = runABAnalysis(withMetrics);
  const abRecs = generateABRecommendations(abResults);

  console.log('[analyst] === A/Bテスト結果 ===');
  for (const [dim, buckets] of Object.entries(abResults)) {
    const sorted = Object.entries(buckets).sort((a, b) => b[1].avg_impressions - a[1].avg_impressions);
    if (sorted.length > 0) {
      console.log(`  ${dim}: ${sorted.map(([k, v]) => `${k}=${v.avg_impressions}imp(${v.count}件)`).join(', ')}`);
    }
  }

  // ===== Claude分析（高度な洞察） =====
  const analysisData = withMetrics.slice(-30).map(h => ({
    text: h.text?.substring(0, 80),
    tweet_type: h.tweet_type || 'standard',
    pattern_id: h.pattern_id,
    theme: h.theme,
    score: h.score?.average || 0,
    impressions: h.metrics?.impressions,
    likes: h.metrics?.likes,
    retweets: h.metrics?.retweets,
    posted_at: h.posted_at
  }));

  let feedback;
  try {
    const response = await createWithRetry({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `投稿パフォーマンスデータを分析。インプレッション最重視。

A/Bテスト結果（自動集計）:
${JSON.stringify(abResults, null, 1)}

直近30件:
${JSON.stringify(analysisData, null, 1)}

JSON出力:
{"analyzed_at":"","total_posts_analyzed":0,"ab_test_results":{},"top_patterns":[],"top_themes":[],"best_hours":[],"avg_impressions":0,"top3_posts":[],"recommendations":["具体的提案"],"patterns_to_avoid":[],"tweet_type_ratio":{"standard":40,"short_personal":25,"contrarian":20,"note_cta":15},"buzz_insights":""}`
      }],
      system: 'JSONのみ出力。A/Bテスト結果を踏まえてtweet_type_ratioを最適化した値で返す。'
    });

    const text = response.content[0].text.trim();
    feedback = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
  } catch (err) {
    console.error('[analyst] Claude分析エラー:', err.message);
    feedback = {
      analyzed_at: new Date().toISOString(),
      total_posts_analyzed: withMetrics.length,
      recommendations: abRecs,
      tweet_type_ratio: { standard: 40, short_personal: 25, contrarian: 20, note_cta: 15 },
    };
  }

  // A/Bテスト結果とローカル推奨をマージ
  feedback.ab_test_results = abResults;
  feedback.ab_recommendations = abRecs;

  writeJSON(path.join(DATA_DIR, 'analyst_feedback.json'), feedback);

  console.log(`[analyst] 分析完了。`);
  console.log(`  推奨タイプ比率: ${JSON.stringify(feedback.tweet_type_ratio || {})}`);
  console.log(`  TOP推奨: ${(feedback.recommendations || []).slice(0, 2).join(' / ')}`);
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
