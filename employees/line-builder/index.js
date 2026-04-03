/**
 * 社員7: LINEビルダー（line-builder）
 * 月次でLINE配信シナリオ＋導線用投稿テンプレートを生成
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { createWithRetry } = require('../../lib/anthropic-client');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const LOG_DIR = path.join(__dirname, '..', 'logs', 'line-scenarios');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'line-builder.log');

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
 * Claude APIでLINE配信シナリオを生成
 */
async function generateLineScenario() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const brandVoice = loadText(path.join(CONFIG_DIR, 'brand-voice.md'));
  const targetAudience = loadText(path.join(CONFIG_DIR, 'target-audience.md'));

  const systemPrompt = `あなたは投資分析Xアカウント「kaizokuokabu」のLINE公式アカウント配信担当です。

## ブランドボイス
${brandVoice.substring(0, 1000)}

## ターゲット
${targetAudience.substring(0, 800)}

## 方針
- X投稿で価値を示す → 「もっと深い話はLINEで」の自然な導線
- 強引な誘導はしない（ブランド毀損防止）
- 無料コンテンツで信頼構築 → 有料Noteへの自然な導線

## 禁止
- 「無料LINE登録で〇〇プレゼント」系の煽り
- 情報商材的な表現
- 「月収100万」等の煽り文句`;

  const userPrompt = `${year}年${month}月のLINE配信計画を作成してください。

以下をJSON形式で出力：
{
  "month": "${year}-${String(month).padStart(2, '0')}",
  "step_messages": [
    {
      "step": 1,
      "day": 0,
      "title": "友だち追加ありがとう",
      "content": "メッセージ本文（200文字以内）",
      "cta": "次のアクション"
    }
  ],
  "weekly_plan": {
    "monday": "今週の注目イベント",
    "wednesday": "銘柄分析 or セクター分析",
    "friday": "週間振り返り＋来週の戦略"
  },
  "x_post_templates": [
    {
      "text": "LINE導線用のX投稿テンプレート",
      "timing": "note_cta投稿の後に使用"
    }
  ]
}

ステップメッセージ5通、X投稿テンプレート3パターンを作成してください。`;

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
  log(`=== line-builder 開始（${monthKey}）===`);

  const outputFile = path.join(LOG_DIR, `${monthKey}.json`);
  if (fs.existsSync(outputFile)) {
    log(`今月のシナリオは作成済み: ${outputFile}`);
    return null;
  }

  const scenario = await generateLineScenario();
  if (!scenario) {
    log('シナリオ生成失敗');
    return null;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(scenario, null, 2));
  log(`シナリオ保存: ${outputFile}`);
  log(`ステップメッセージ: ${scenario.step_messages?.length || 0}通`);
  log(`X投稿テンプレート: ${scenario.x_post_templates?.length || 0}パターン`);
  log(`=== line-builder 完了 ===`);

  return scenario;
}

if (require.main === module) {
  run().then(scenario => {
    if (scenario) console.log(`\n✅ LINEシナリオを生成しました`);
    else console.log(`ℹ️ 今月のシナリオは作成済みか、生成に失敗しました`);
  }).catch(err => {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { run };
