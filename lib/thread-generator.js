/**
 * スレッド投稿用の連投ツイート生成器
 * Claude Opusでフック→本論→CTAの流れを作る
 */
const { createWithRetry } = require('./anthropic-client');

const MODEL = 'claude-sonnet-4-6';

/**
 * スレッド生成
 * @param {Object} params
 * @param {string} params.theme — テーマ（例: "キオクシア285Aの投資戦略"）
 * @param {string} params.sourceContent — 元ネタ（Note記事本文など、任意）
 * @param {number} params.tweetCount — ツイート本数（デフォルト6）
 * @param {string} params.ctaUrl — 末尾に付けるNote URL（任意）
 * @returns {Promise<string[]>} ツイート文字列の配列
 */
async function generateThread({ theme, sourceContent = '', tweetCount = 6, ctaUrl = '' }) {
  const ctaBlock = ctaUrl
    ? `\n最終ツイート（${tweetCount}/${tweetCount}）は「深掘りはNoteに書いた」系のCTA。末尾に ${ctaUrl} を必ず含める。`
    : `\n最終ツイート（${tweetCount}/${tweetCount}）は軽い問いかけで終える（例: "みんなはどう見てる？"）。`;

  const sourceBlock = sourceContent
    ? `\n\n## 参考資料（この内容を要約・抜粋してスレッドに使う）\n${sourceContent.slice(0, 8000)}`
    : '';

  const prompt = `あなたは @kaizokuokabu という投資系Xアカウントの運用担当。
日本の個人投資家向けに、鋭いIPO/個別株分析を"中学生にも分かる言葉で"発信している。
トーンはゆきママ風の挑発的・断定的。ただし攻撃的ではない。

## タスク
テーマ「${theme}」について、${tweetCount}連投のスレッドを作る。

## スレッド構造（厳守）
1/${tweetCount}: フック（強烈な1行で読ませる。数字や逆説を入れる。140字以内）
2/${tweetCount}: 前提・背景（なぜ今これが話題なのか）
3/${tweetCount}〜${tweetCount-1}/${tweetCount}: 本論（具体データ、数字、論理展開）
${tweetCount}/${tweetCount}: 締め＋CTA${ctaBlock}

## 各ツイートのルール
- **1ツイート = 280字（日本語140字目安、ハッシュタグは使わない）**
- 先頭に「1/${tweetCount}」などの番号を必ず入れる
- 1ツイート内で改行を効果的に使う（3-5行に分ける）
- 数字・銘柄コード・具体的な金額を必ず入れる
- 絵文字は最大1ツイートに1つまで（使わなくてもOK）
- 敬体（です・ます）ではなく常体（だ・である）寄り、ただし柔らかく

## 絶対NG
- 空疎な煽り（「絶対儲かる」「100%上がる」など）
- ハッシュタグ
- 連続した顔文字
- 自分のNoteへの冒頭リンク誘導（CTAは末尾のみ）${sourceBlock}

## 出力形式
**必ずJSON配列で返す。マークダウンコードブロックで囲まない。**
[
  "1/${tweetCount} …",
  "2/${tweetCount} …",
  …
]
`;

  const response = await createWithRetry({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();

  // JSON抽出（コードブロック除去）
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`スレッドJSONが見つかりません: ${text.slice(0, 200)}`);
  }

  const tweets = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(tweets) || tweets.length < 3) {
    throw new Error(`スレッドの形式が不正: ${JSON.stringify(tweets).slice(0, 200)}`);
  }

  // 各ツイートの長さ検証（280字超過は自動短縮しない、警告のみ）
  tweets.forEach((t, i) => {
    if (t.length > 280) {
      console.warn(`[thread-generator] ${i + 1}番目のツイートが${t.length}字。280字超過のため投稿時にエラーになる可能性`);
    }
  });

  return tweets;
}

module.exports = { generateThread };
