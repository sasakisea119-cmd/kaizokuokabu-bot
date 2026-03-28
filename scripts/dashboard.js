const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJSON(filePath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function main() {
  const history = readJSON(path.join(DATA_DIR, 'post_history.json'));
  const queue = readJSON(path.join(DATA_DIR, 'queue.json'));
  const rtHistory = readJSON(path.join(DATA_DIR, 'retweet_history.json'));
  const feedback = readJSON(path.join(DATA_DIR, 'analyst_feedback.json'), null);
  const pool = readJSON(path.join(DATA_DIR, 'research_pool.json'));
  const killSwitchOn = fs.existsSync(path.join(DATA_DIR, 'KILL_SWITCH'));

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const thisMonth = new Date().toISOString().substring(0, 7);

  // 基本統計
  const today = new Date().toISOString().split('T')[0];
  const todayPosts = history.filter(h => h.posted_at?.startsWith(today));
  const todayRTs = rtHistory.filter(r => r.quoted_at?.startsWith(today));
  const monthlyPosts = history.filter(h => h.posted_at?.startsWith(thisMonth)).length;
  const monthlyRTs = rtHistory.filter(r => r.quoted_at?.startsWith(thisMonth)).length;

  // メトリクス
  const withMetrics = history.filter(h => h.metrics);
  const totalImpressions = withMetrics.reduce((s, h) => s + (h.metrics.impressions || 0), 0);
  const totalLikes = withMetrics.reduce((s, h) => s + (h.metrics.likes || 0), 0);
  const totalRTs = withMetrics.reduce((s, h) => s + (h.metrics.retweets || 0), 0);
  const avgImpressions = withMetrics.length > 0 ? Math.round(totalImpressions / withMetrics.length) : 0;

  // TOP3
  const top3 = [...withMetrics]
    .sort((a, b) => (b.metrics.impressions || 0) - (a.metrics.impressions || 0))
    .slice(0, 3);

  // 品質スコア
  const scores = history.slice(-10).filter(h => h.score?.average).map(h => h.score.average);
  const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '-';

  // パターン分布
  const patternDist = {};
  history.forEach(h => {
    if (h.pattern_id) patternDist[h.pattern_id] = (patternDist[h.pattern_id] || 0) + 1;
  });

  // テーマ分布
  const themeDist = {};
  history.forEach(h => {
    if (h.theme) themeDist[h.theme] = (themeDist[h.theme] || 0) + 1;
  });

  // 表示
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           kaizokuokabu Dashboard                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // KILL SWITCH
  if (killSwitchOn) {
    const reason = fs.readFileSync(path.join(DATA_DIR, 'KILL_SWITCH'), 'utf-8');
    console.log(`  *** KILL SWITCH ON: ${reason} ***`);
    console.log('  解除: bash scripts/resume.sh');
    console.log('');
  }

  // インプレッション（最も目立つように）
  console.log('  ╭─────────────────────────────────────╮');
  console.log(`  │  TOTAL IMPRESSIONS: ${totalImpressions.toLocaleString().padStart(12)}   │`);
  console.log(`  │  AVG PER POST:      ${avgImpressions.toLocaleString().padStart(12)}   │`);
  console.log('  ╰─────────────────────────────────────╯');
  console.log('');

  // 投稿状況
  console.log('  [投稿状況]');
  console.log(`    本日投稿:        ${todayPosts.length}本（オリジナル）+ ${todayRTs.length}本（引用RT）`);
  console.log(`    キュー残:        ${queue.length}本`);
  console.log(`    月間投稿:        ${monthlyPosts + monthlyRTs} / 500（オリジナル${monthlyPosts} + 引用RT${monthlyRTs}）`);
  console.log(`    累計投稿:        ${history.length}本`);
  console.log(`    引用RT累計:      ${rtHistory.length}本`);
  console.log('');

  // エンゲージメント
  console.log('  [エンゲージメント]');
  console.log(`    総いいね:        ${totalLikes.toLocaleString()}`);
  console.log(`    総リツイート:    ${totalRTs.toLocaleString()}`);
  console.log(`    メトリクス取得済: ${withMetrics.length}/${history.length}件`);
  console.log('');

  // TOP3
  if (top3.length > 0) {
    console.log('  [パフォーマンス TOP3]');
    top3.forEach((post, i) => {
      console.log(`    #${i + 1} imp:${post.metrics.impressions.toLocaleString()} like:${post.metrics.likes} rt:${post.metrics.retweets}`);
      console.log(`       ${post.text.substring(0, 60)}...`);
    });
    console.log('');
  }

  // 品質
  console.log('  [品質]');
  console.log(`    直近10件平均スコア: ${avgScore}`);
  console.log('');

  // パターン/テーマ分布
  if (Object.keys(patternDist).length > 0) {
    console.log('  [パターン分布]');
    const sorted = Object.entries(patternDist).sort((a, b) => b[1] - a[1]).slice(0, 5);
    sorted.forEach(([p, c]) => console.log(`    ${p}: ${'█'.repeat(Math.min(c, 20))} (${c})`));
    console.log('');
  }

  if (Object.keys(themeDist).length > 0) {
    console.log('  [テーマ分布]');
    const sorted = Object.entries(themeDist).sort((a, b) => b[1] - a[1]).slice(0, 5);
    sorted.forEach(([t, c]) => console.log(`    ${t}: ${'█'.repeat(Math.min(c, 20))} (${c})`));
    console.log('');
  }

  // リサーチプール
  const unusedPool = pool.filter(r => !r.used);
  console.log(`  [リサーチプール] 合計:${pool.length}件 未使用:${unusedPool.length}件`);

  // フィードバック
  if (feedback?.recommendations) {
    console.log('');
    console.log('  [アナリスト推奨]');
    feedback.recommendations.slice(0, 3).forEach(r => console.log(`    - ${r}`));
  }

  console.log('');
  console.log('──────────────────────────────────────────────────────────');
}

main();
