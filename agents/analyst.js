require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DATA_DIR = path.join(__dirname, '..', 'data');

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

async function run() {
  console.log('[analyst] パフォーマンス分析開始...');

  const history = readJSON(path.join(DATA_DIR, 'post_history.json'));

  // メトリクス取得済みの投稿を抽出
  const withMetrics = history.filter(h => h.metrics);

  if (withMetrics.length < 10) {
    console.log(`[analyst] メトリクス取得済み${withMetrics.length}件（10件未満）。分析スキップ。`);
    return;
  }

  console.log(`[analyst] ${withMetrics.length}件を分析中...`);

  const analysisData = withMetrics.map(h => ({
    tweet_id: h.tweet_id,
    text: h.text.substring(0, 100),
    pattern_id: h.pattern_id,
    hook_id: h.hook_id,
    theme: h.theme,
    score: h.score?.average || 0,
    impressions: h.metrics.impressions,
    likes: h.metrics.likes,
    retweets: h.metrics.retweets,
    replies: h.metrics.replies,
    posted_at: h.posted_at
  }));

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `以下の投稿パフォーマンスデータを分析して、ライターへのフィードバックをJSON形式で出力してください。

データ：
${JSON.stringify(analysisData, null, 2)}

分析の観点（インプレッション数を最重視）：
1. パターン別パフォーマンス（どのパターンIDがインプ高いか）
2. テーマ別パフォーマンス（どのテーマがバズるか）
3. フック別パフォーマンス（どのフックIDが効果的か）
4. 時間帯別パフォーマンス（何時の投稿がインプ高いか）
5. 「どんな投稿がバズったか」の共通点
6. 「どうすればもっとインプが伸びるか」の具体的提案

出力形式（JSONのみ）：
{
  "analyzed_at": "ISO日時",
  "total_posts_analyzed": N,
  "top_patterns": ["P01", ...],
  "top_themes": ["テーマ名", ...],
  "top_hooks": ["H01", ...],
  "best_hours": [7, 17, ...],
  "avg_impressions": N,
  "top3_posts": [{"tweet_id": "...", "impressions": N, "why": "理由"}],
  "recommendations": [
    "具体的な改善提案1",
    "具体的な改善提案2",
    "具体的な改善提案3"
  ],
  "patterns_to_avoid": ["P05", ...],
  "buzz_insights": "バズの法則まとめ（100文字以内）"
}`
    }],
    system: 'JSONのみ出力してください。マークダウンのコードブロックは不要です。'
  });

  let feedback;
  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    feedback = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[analyst] JSON解析エラー:', err.message);
    feedback = {
      analyzed_at: new Date().toISOString(),
      total_posts_analyzed: withMetrics.length,
      recommendations: ['分析データが不十分です。投稿を続けてください。'],
      error: 'JSON解析失敗'
    };
  }

  writeJSON(path.join(DATA_DIR, 'analyst_feedback.json'), feedback);
  console.log(`[analyst] 分析完了。TOP推奨: ${(feedback.recommendations || []).slice(0, 2).join(' / ')}`);
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
