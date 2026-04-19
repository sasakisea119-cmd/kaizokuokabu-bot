/**
 * インスパイアツイート生成器
 * 「ターゲットアカウントのバズ投稿のネタを借りて、自分の言葉で書き直す」
 *
 * 引用RTやリプライではなく、独立した自分の投稿として再構成する。
 * X側にも検知されにくく、ネタ枯渇問題も同時に解決する正攻法。
 */
const { createWithRetry } = require('./anthropic-client');

const MODEL = 'claude-haiku-4-5-20251001';

/**
 * 元ツイートからインスパイアを受けて自分のツイートを生成
 * @param {Object} params
 * @param {string} params.sourceText - 元ツイート本文
 * @param {string} params.sourceAuthor - 元投稿者ユーザー名（プロンプトでのみ使う、本文には出さない）
 * @returns {Promise<{text:string, angle:string}|null>}
 */
async function generateInspiredTweet({ sourceText, sourceAuthor = '' }) {
  const prompt = `あなたは @kaizokuokabu というIPO・個別株中心のX投資アカウント運用者。

下記は他アカウントのツイート。
これを引用するのではなく、**ネタ・観点だけを借りて、自分の独立投稿として書き直す**のが今回のミッション。

## 元ツイート（@${sourceAuthor || 'unknown'}）
"""
${sourceText}
"""

## 書き直しの方針（3つから1つ選ぶ）
**A. 角度ずらし**: 元と同じテーマで、別の切り口（例: 元が個人感情→自分は数字データ）
**B. 深掘り**: 元の話題を一段深く掘る（例: 元がニュース紹介→自分は投資角度の解釈）
**C. 反対意見**: 元と逆の立場でロジカルに書く（建設的、煽らない）

## 必須ルール
- 元投稿への言及・引用・「〇〇さんの投稿見て」等は一切書かない（独立ツイート）
- 元と全く同じ言い回しは使わない（パクリ判定回避）
- 130〜220字
- 銘柄名は「KOKUSAI（6525）」のように証券コード付きで
- 数字を1つ以上含める（株価、PER、％、円など）
- 改行で3〜4行に区切る
- 絵文字は2〜3個（行頭アイコン優先）
- ハッシュタグ1〜2個（投稿テーマに合うもの）
- 最後は問いかけor軽い挑発で締める

## NG
- 元投稿の主旨と大きくズレた内容
- 投資と無関係な話題への脱線
- 「買え」「売れ」の明確な推奨

## 出力形式
JSONのみ：
{"angle":"A|B|C","text":"投稿本文"}
`;

  try {
    const response = await createWithRetry({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text.trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (!parsed.text || typeof parsed.text !== 'string') return null;
    if (parsed.text.length < 80 || parsed.text.length > 280) {
      console.warn(`[inspire-generator] 生成テキストが${parsed.text.length}字。範囲外スキップ`);
      return null;
    }
    return { text: parsed.text.trim(), angle: parsed.angle || '?' };
  } catch (err) {
    console.error(`[inspire-generator] エラー: ${err.message}`);
    return null;
  }
}

module.exports = { generateInspiredTweet };
