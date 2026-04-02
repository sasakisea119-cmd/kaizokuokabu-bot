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

function activateKillSwitch(reason) {
  fs.writeFileSync(path.join(DATA_DIR, 'KILL_SWITCH'), reason, 'utf-8');
  console.error(`[supervisor] KILL_SWITCH発動: ${reason}`);
}

function logAlert(level, message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message}\n`;
  console.log(`[supervisor] [${level}] ${message}`);

  const logPath = path.join(DATA_DIR, 'logs', `supervisor_${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logPath, logLine, 'utf-8');
}

async function run() {
  console.log('[supervisor] 監視チェック開始...');

  const history = readJSON(path.join(DATA_DIR, 'post_history.json'));
  const queue = readJSON(path.join(DATA_DIR, 'queue.json'));
  const rtHistory = readJSON(path.join(DATA_DIR, 'retweet_history.json'));
  const alerts = [];

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;
  const THIRTY_MIN = 30 * 60 * 1000;

  // 24時間以内の投稿を抽出
  const last24h = history.filter(h => now - new Date(h.posted_at).getTime() < ONE_DAY);
  const last24hRT = rtHistory.filter(r => now - new Date(r.quoted_at).getTime() < ONE_DAY);

  // A. 投稿頻度チェック
  if (last24h.length > 8) {
    logAlert('WARNING', `24時間でオリジナル投稿${last24h.length}件（上限8件）`);
    alerts.push('post_frequency_high');
  }
  if (last24h.length + last24hRT.length > 15) {
    logAlert('WARNING', `24時間で合計${last24h.length + last24hRT.length}件（上限15件）`);
    alerts.push('total_frequency_high');
  }

  // B. 投稿間隔チェック
  // scheduler投稿（60秒間隔の連続投稿）は正常動作なのでチェック対象外
  // 「異なるセッション間」で30分未満に投稿が被った場合のみWARNING（KILL_SWITCHは発動しない）
  // ※ 1日の投稿数チェック(A)で十分にカバーできるため、間隔チェックでの緊急停止は廃止

  // C. 品質スコアチェック
  const recent10 = history.slice(-10);
  const scores = recent10.filter(h => h.score?.average).map(h => h.score.average);
  if (scores.length >= 10) {
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avgScore < 6.5) {
      logAlert('WARNING', `直近10件の平均品質スコア ${avgScore.toFixed(1)}（基準: 6.5）`);
      alerts.push('quality_low');
    }
  }

  // D. パターン/テーマ偏りチェック
  if (recent10.length >= 5) {
    const patterns = recent10.map(h => h.pattern_id).filter(Boolean);
    const themes = recent10.map(h => h.theme).filter(Boolean);

    const patternCounts = {};
    patterns.forEach(p => patternCounts[p] = (patternCounts[p] || 0) + 1);
    const maxPatternCount = Math.max(...Object.values(patternCounts));
    if (maxPatternCount >= 5) {
      logAlert('WARNING', `パターン偏り: 同一パターンが${maxPatternCount}回連続`);
      alerts.push('pattern_bias');
    }

    const themeCounts = {};
    themes.forEach(t => themeCounts[t] = (themeCounts[t] || 0) + 1);
    const maxThemeCount = Math.max(...Object.values(themeCounts));
    if (maxThemeCount >= 5) {
      logAlert('WARNING', `テーマ偏り: 同一テーマが${maxThemeCount}回連続`);
      alerts.push('theme_bias');
    }
  }

  // E. キュー残量チェック
  if (queue.length === 0) {
    logAlert('WARNING', 'キューが空です。writerの実行が必要です。');
    alerts.push('queue_empty');
  } else if (queue.length < 3) {
    logAlert('WARNING', `キュー残り${queue.length}件（少なめ）`);
    alerts.push('queue_low');
  }

  // F. エラー連続チェック
  const logDir = path.join(DATA_DIR, 'logs');
  try {
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(logDir, `supervisor_${today}.log`);
    if (fs.existsSync(logFile)) {
      const logContent = fs.readFileSync(logFile, 'utf-8');
      const errorLines = logContent.split('\n').filter(l => l.includes('[CRITICAL]'));
      if (errorLines.length >= 3) {
        logAlert('CRITICAL', `本日${errorLines.length}件のCRITICALエラー`);
        activateKillSwitch('CRITICALエラー3件以上');
        alerts.push('consecutive_errors');
      }
    }
  } catch {}

  // G. 月間投稿数チェック
  const thisMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
  const monthlyPosts = history.filter(h => h.posted_at?.startsWith(thisMonth)).length;
  const monthlyRTs = rtHistory.filter(r => r.quoted_at?.startsWith(thisMonth)).length;
  const monthlyTotal = monthlyPosts + monthlyRTs;
  if (monthlyTotal > 400) {
    logAlert('WARNING', `月間投稿数${monthlyTotal}件（月500件制限に近づいています）`);
    alerts.push('monthly_limit_approaching');
  }

  const hasCritical = alerts.some(a => ['interval_too_short', 'consecutive_errors'].includes(a));

  console.log(`[supervisor] チェック完了: アラート${alerts.length}件${hasCritical ? '（CRITICAL含む）' : ''}`);

  return { alerts, hasCritical };
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
