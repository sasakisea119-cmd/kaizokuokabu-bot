/**
 * 短文ツイート生成器
 * 「さらっと読める」20〜60字級の超短文ツイートを生成。
 * 一発ネタ・実況・つぶやき系。重い分析ツイートの合間に挟むことで
 * タイムライン上の読みやすさ・親近感UPを狙う。
 */
const { createWithRetry } = require('./anthropic-client');
const { buildFreshnessContext } = require('./freshness');

const MODEL = 'claude-haiku-4-5-20251001';

const STYLES = {
  jisseki: {
    label: '実績共有',
    examples: [
      'KOKUSAI 6525、含み益+18%。やっぱ仕込んでよかった。',
      'IPO当選通知きた。バトンズ（554A）。今週の楽しみ増えた。',
      '日経59,500円タッチ。半年前の弱気派どこいった。',
    ],
  },
  jikkyou: {
    label: '市場実況',
    examples: [
      'TOPIX -1.4%、結構効いてる。半導体系が重い。',
      '今日のIPO初値、また公募割れか…。市況きついな。',
      'メタプラ（3350）出来高2倍、何か来てる？',
    ],
  },
  tsubuyaki: {
    label: '個人つぶやき',
    examples: [
      '相場見てたら寝る時間なくなったw',
      '銘柄選定、結局1日かけて1銘柄しか決まらん。',
      'PERだけ見て買う時代もうないよね。',
    ],
  },
  toikake: {
    label: '問いかけ',
    examples: [
      'みんな今、現金比率どのくらい？',
      '初心者の頃に戻れるなら、最初に何買う？',
      '日経6万円、来ると思う？それとも調整入る？',
    ],
  },
};

/**
 * 短文ツイートを生成
 * @param {Object} opts
 * @param {string} opts.style - 'jisseki' | 'jikkyou' | 'tsubuyaki' | 'toikake' | 'auto'
 * @param {string} opts.context - 直近の市場状況・ネタ（任意）
 * @returns {Promise<string|null>}
 */
async function generateShortTweet({ style = 'auto', context = '' } = {}) {
  const chosenKey = style === 'auto'
    ? Object.keys(STYLES)[Math.floor(Math.random() * Object.keys(STYLES).length)]
    : style;
  const cfg = STYLES[chosenKey] || STYLES.tsubuyaki;

  const prompt = `あなたは @kaizokuokabu というX投資アカウントの運用者。
「${cfg.label}」型の超短文ツイートを1つだけ生成して。

${buildFreshnessContext()}

## 条件
- 20〜60字（厳守）
- 1〜2行のみ
- 絵文字は0〜1個まで
- ハッシュタグなし
- 銘柄名は「KOKUSAI（6525）」「メタプラ（3350）」のように略称＋証券コード
- 上から目線NG。仲間内のつぶやき感
- リプ・引用したくなる「余白」を残す
- **具体的な株価円数は使わない**（ズレるから。「上昇中」「急落」などぼかす）

## 参考スタイル
${cfg.examples.map((e, i) => `${i + 1}. ${e}`).join('\n')}

## 直近の市場状況
${context || '（特になし、汎用的なつぶやきでOK）'}

## 出力
- 本文1行のみ。前置き・解説・絵文字解説などは一切書かない
- ${cfg.label}の雰囲気を必ず守ること`;

  try {
    const response = await createWithRetry({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    let text = response.content[0].text.trim();
    // 余計な「」を削除
    text = text.replace(/^「(.+)」$/, '$1').replace(/^"(.+)"$/, '$1').trim();
    if (text.length < 10 || text.length > 100) {
      console.warn(`[short-generator] 生成テキストが${text.length}字で範囲外。スキップ`);
      return null;
    }
    return { text, style: chosenKey, label: cfg.label };
  } catch (err) {
    console.error(`[short-generator] エラー: ${err.message}`);
    return null;
  }
}

module.exports = { generateShortTweet, STYLES };
