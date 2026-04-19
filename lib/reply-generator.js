/**
 * インターセプトリプライ生成器
 * 対象ツイートに対し、共感＋独自視点＋具体数字の3要素リプを生成
 */
const { createWithRetry } = require('./anthropic-client');

const MODEL = 'claude-haiku-4-5-20251001';

/**
 * リプライ生成
 * @param {Object} params
 * @param {string} params.sourceTweet — 対象ツイート本文
 * @param {string} params.sourceAuthor — 対象ツイートの投稿者（例: "ゆきママ"）
 * @param {string} params.context — 運用者の強み領域（省略時はIPO/個別株投資）
 * @returns {Promise<string|null>} リプ本文。判断基準を満たさない場合はnull
 */
async function generateReply({ sourceTweet, sourceAuthor = '', context = 'IPO投資と話題の個別株分析' }) {
  const prompt = `あなたは @kaizokuokabu という投資系Xアカウント（${context}）の運用者。
大手アカウントのツイートに"質の高いリプ"を打ち込んでフォロワーを獲得するミッション。

## 対象ツイート
投稿者: @${sourceAuthor}
本文:
"""
${sourceTweet}
"""

## リプを打つか判断する（最重要）
以下のいずれかに該当する場合は、必ず "SKIP" と1単語だけ返す：
- 投資と全く関係ない話題（日常、感情吐露、ニュース一般、個人攻撃など）
- すでに具体的で完結した分析で、付け加える余地がない
- センシティブな話題（政治論争、差別発言、健康問題の断定など）
- 1文しかない短い呟き（リプが浮く）
- 対象が明確な銘柄や投資行動ではない

## リプを打つ場合のルール
1. **共感/同意** から始める（相手を立てる1行）
2. **独自視点** を入れる（自分ならこう見る）
3. **具体数字** を入れる（銘柄コード、株価、PER、日付など）
4. 200字以内（短い方が読まれる）
5. 絵文字は0〜1個まで
6. 自分のNote/LINEへの誘導は絶対NG
7. 断定を避けつつ、自分の見立ては明確に
8. 相手を否定しない・上から目線にしない
9. ハッシュタグ不使用
10. 末尾は軽い問いかけ or 余韻で終える（「どう見てる？」など）

## 出力形式
- リプを打たない場合: "SKIP" の1単語のみ
- リプを打つ場合: リプ本文のみ（前置きや説明は一切不要）
`;

  try {
    const response = await createWithRetry({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.trim();

    if (text === 'SKIP' || text.startsWith('SKIP')) {
      return null;
    }

    if (text.length > 280) {
      console.warn(`[reply-generator] 生成リプが${text.length}字。280字超過のためスキップ`);
      return null;
    }

    if (text.length < 20) {
      console.warn(`[reply-generator] 生成リプが${text.length}字で短すぎるためスキップ`);
      return null;
    }

    return text;
  } catch (err) {
    console.error(`[reply-generator] エラー: ${err.message}`);
    return null;
  }
}

module.exports = { generateReply };
