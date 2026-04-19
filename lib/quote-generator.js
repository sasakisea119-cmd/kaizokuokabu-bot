/**
 * 引用RTコメント生成器
 * 対象ツイートに独自コメントを付けて引用する。
 * 3つの型（独自データ追加型/反論・別視点型/解説型）から最適なものを自動選択
 */
const { createWithRetry } = require('./anthropic-client');
const { buildFreshnessContext } = require('./freshness');

const MODEL = 'claude-haiku-4-5-20251001';

/**
 * 引用コメント生成
 * @param {Object} params
 * @param {string} params.sourceTweet — 引用元ツイート本文
 * @param {string} params.sourceAuthor — 投稿者のユーザー名
 * @param {string} params.context — 運用者の強み領域
 * @returns {Promise<string|null>} 引用コメント。引用不適ならnull
 */
async function generateQuoteComment({ sourceTweet, sourceAuthor = '', context = 'IPO投資と話題の個別株分析' }) {
  const prompt = `あなたは @kaizokuokabu という投資系Xアカウント（${context}）の運用担当。
大手アカウントの投稿に独自コメントを付けて"引用RT"し、タイムラインでの存在感を作るのがミッション。

${buildFreshnessContext()}

## 引用元ツイート
投稿者: @${sourceAuthor}
本文:
"""
${sourceTweet}
"""

## 引用するか判断する（最重要）
以下のいずれかに該当する場合は、必ず "SKIP" と1単語だけ返す：
- 投資と全く関係ない話題（日常、感情吐露、個人攻撃、政治論争、健康問題）
- 画像/動画のみで本文の情報量が極端に少ない
- 「ストップ高おめ」等の1フレーズ投稿
- 引用する価値のある論点がない
- センシティブ（差別、煽り、誹謗中傷）

## 引用する場合、3つの型から選ぶ
**型1: 独自データ追加型** — 「これ面白い。ちなみに〇〇も…」で自分の知ってる数字・銘柄を足す
**型2: 反論・別視点型** — 「ちょっと待って、〇〇の観点で見ると…」で建設的に別視点を出す
**型3: 解説型** — 「これ初心者向けに補足すると…」で用語や文脈を噛み砕く

投稿の性質に合わせて1つ選び、その型で書く。

## 文体ルール
1. 200〜270字（ハッシュタグ不使用）
2. 改行で3〜5行に区切って視認性UP
3. 具体数字を必ず1つ以上入れる（**ただし鮮度ルール遵守**：銘柄コード・PER・PBR・変化率%・年数などの「鮮度に依存しない数字」を使う。具体株価円は原則避ける）
4. 断定しすぎず、でも中立すぎない（意見を持つ）
5. 最後は問いかけ or 軽い挑発で締める（"みんなどう見てる？" 等）
6. 絵文字は0〜1個
7. 元投稿者を否定・攻撃しない（型2でも建設的に）
8. 自分のNote/LINEへの誘導は絶対NG
9. 敬体と常体を混ぜてOK、ゆきママ風でもOK

## 出力形式
- 引用しない場合: "SKIP" の1単語のみ
- 引用する場合: 引用コメント本文のみ（前置き・説明・型番は書かない）
`;

  try {
    const response = await createWithRetry({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.trim();

    if (text === 'SKIP' || text.startsWith('SKIP')) {
      return null;
    }

    if (text.length > 280) {
      console.warn(`[quote-generator] 生成コメントが${text.length}字。280字超過のためスキップ`);
      return null;
    }

    if (text.length < 30) {
      console.warn(`[quote-generator] 生成コメントが${text.length}字で短すぎるためスキップ`);
      return null;
    }

    return text;
  } catch (err) {
    console.error(`[quote-generator] エラー: ${err.message}`);
    return null;
  }
}

module.exports = { generateQuoteComment };
