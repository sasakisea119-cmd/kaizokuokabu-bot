/**
 * 社員6: プロダクトクリエイター（product-creator）
 * 月次で収益化コンテンツの企画書を自動生成
 * Note記事・無料コンテンツ・アフィリエイト企画
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { createWithRetry } = require('../../lib/anthropic-client');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const LOG_DIR = path.join(__dirname, '..', 'logs', 'product-plans');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'product-creator.log');

function log(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  console.log(line.trim());
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* ignore */ }
}

function loadText(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch { /* ignore */ }
  return '';
}

/**
 * Claude APIで月次企画書を生成
 */
async function generateMonthlyPlan() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const brandVoice = loadText(path.join(CONFIG_DIR, 'brand-voice.md'));
  const targetAudience = loadText(path.join(CONFIG_DIR, 'target-audience.md'));
  const feedback = loadText(path.join(DATA_DIR, 'analyst_feedback.json'));

  const systemPrompt = `あなたは投資分析Xアカウント「kaizokuokabu」の収益化コンテンツ企画担当です。

## ブランドボイス
${brandVoice.substring(0, 1000)}

## ターゲットオーディエンス
${targetAudience.substring(0, 1000)}

## 制約
- 特定銘柄の買い/売り推奨はしない
- アフィリエイトリンクは月2本まで
- 有料Note記事は月4本まで
- 「投資は自己責任」はプロフィールに記載済みなので記事内に書かない`;

  const userPrompt = `${year}年${month}月の収益化コンテンツ企画書を作成してください。

以下をJSON形式で出力：
{
  "month": "${year}-${String(month).padStart(2, '0')}",
  "note_articles": [
    {
      "title": "記事タイトル",
      "outline": ["セクション1", "セクション2", ...],
      "target_persona": "タカシ/ユウキ/マサキ",
      "monetization": "有料Note（500円）/ 無料",
      "planned_week": 1
    }
  ],
  "free_content": [
    {
      "title": "コンテンツタイトル",
      "type": "thread / review / guide",
      "planned_week": 1
    }
  ],
  "affiliate": [
    {
      "title": "企画タイトル",
      "type": "証券口座 / 投資本 / ツール",
      "planned_week": 2
    }
  ],
  "monthly_theme": "今月の統一テーマ"
}

Note記事4本、無料コンテンツ8本、アフィリエイト2本で計画してください。
過去のパフォーマンスデータ: ${feedback.substring(0, 500)}`;

  const response = await createWithRetry({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* fallthrough */ }
  }
  return null;
}

/**
 * メイン実行
 */
async function run() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  log(`=== product-creator 開始（${monthKey}）===`);

  // 既に今月の企画書がある場合はスキップ
  const outputFile = path.join(LOG_DIR, `${monthKey}.json`);
  if (fs.existsSync(outputFile)) {
    log(`今月の企画書は作成済み: ${outputFile}`);
    return null;
  }

  const plan = await generateMonthlyPlan();
  if (!plan) {
    log('企画書生成失敗');
    return null;
  }

  // 保存
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(plan, null, 2));
  log(`企画書保存: ${outputFile}`);
  log(`Note記事: ${plan.note_articles?.length || 0}本`);
  log(`無料コンテンツ: ${plan.free_content?.length || 0}本`);
  log(`アフィリエイト: ${plan.affiliate?.length || 0}本`);
  log(`=== product-creator 完了 ===`);

  return plan;
}

if (require.main === module) {
  run().then(plan => {
    if (plan) console.log(`\n✅ 月次企画書を生成しました`);
    else console.log(`ℹ️ 今月の企画書は作成済みか、生成に失敗しました`);
  }).catch(err => {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { run };
