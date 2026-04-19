/**
 * 投稿鮮度ユーティリティ
 * - 全投稿生成器で共有する「今日の日付」「鮮度ルール」を集約
 * - research_pool の古いネタをフィルタ
 *
 * 株式投資の投稿は「当日の情報」であることが極めて重要。
 * Anthropicモデルは学習データカットオフ以降の株価や日付を知らないため、
 * 具体的な株価・日付を出すと必ずズレる。
 * よって、時間表現は「相対表現」に統一し、絶対日付は動的に注入する。
 */

/**
 * プロンプトに埋め込む「今日の文脈」ブロック
 * @returns {string}
 */
function buildTodayContext() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const iso = jst.toISOString();
  const yyyy = iso.slice(0, 4);
  const mm = iso.slice(5, 7);
  const dd = iso.slice(8, 10);
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()];
  const hour = parseInt(iso.slice(11, 13), 10);

  let timeOfDay;
  if (hour >= 5 && hour < 11) timeOfDay = '朝（寄り前〜寄り付き直後）';
  else if (hour >= 11 && hour < 15) timeOfDay = '日中（前場〜後場）';
  else if (hour >= 15 && hour < 18) timeOfDay = '大引け後（夕方）';
  else if (hour >= 18 && hour < 23) timeOfDay = '夜（市場クローズ後）';
  else timeOfDay = '深夜〜早朝';

  return `## 現在時刻（必読・絶対遵守）
本日: ${yyyy}年${mm}月${dd}日（${weekday}）JST
時間帯: ${timeOfDay}

この日付・時間帯を前提に投稿を作成すること。
「来週」「先週」「今日の引け」など時間表現は全て本日基準で整合性を取ること。`;
}

/**
 * プロンプトに埋め込む「鮮度ルール」ブロック
 * 株価・日付のズレを防ぐための必須ルール
 * @returns {string}
 */
function buildFreshnessRules() {
  return `## 鮮度ルール（絶対遵守・ズレると信頼失墜）

### 時間表現の統一
- 具体的な日付（「2025年◯月」等）は使わない。代わりに「先月」「去年」「今週」など相対表現を使う
- 「来週のIPO」「昨日の引け」のような本日基準の表現に統一
- 本日以前の過去イベントに対して「今度」「来週」などの未来形を使わない

### 株価・業績数字の扱い
- **具体的な株価円数は使わない**（モデルの学習データは古く、実際と大きくズレる可能性が高い）
- 代わりに「直近高値圏」「年初来安値タッチ」「PBR1倍割れ」など**相対的・定性的な表現**を使う
- どうしても数字を出したい場合は「〜円台」「〜倍上昇」のように幅のある表現に
- 時価総額・PER・配当利回りも同様に相対表現を優先

### 銘柄コード
- 証券コードは必ず4桁数字（または3桁+英字）で明記（例：東京エレクトロン（8035））
- 銘柄名はよく知られた略称+コードで（「トヨタ（7203）」）

### IPO・決算スケジュール
- 上場日・決算日などの具体日付はresearch_poolで明示提供されたもの以外は使わない
- 不明な場合は「今月中の上場」「来週の決算」など相対表現で

### 許容される具体数字
- 指数（日経平均、TOPIX、S&P500）の「〜円台」「〜ポイント台」は許容（ただし幅で書く）
- PBR/PER/配当利回りは「1倍割れ」「10倍台」「4%超」など幅でOK
- 過去イベントの「+20%」「-30%」のような変化率は可`;
}

/**
 * research_poolから鮮度の高いネタのみをフィルタ
 * @param {Array} pool - research_pool.json
 * @param {Object} opts
 * @param {number} opts.maxAgeDays - 許容最大日数（デフォルト7日）
 * @returns {Array} - 鮮度の高いネタのみ
 */
function filterFreshResearch(pool, opts = {}) {
  const maxAgeDays = opts.maxAgeDays || 7;
  const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
  if (!Array.isArray(pool)) return [];
  return pool.filter(r => {
    if (!r) return false;
    const ts = new Date(r.created_at || r.fetched_at || r.published_at || 0).getTime();
    if (!ts) return false;
    return ts >= cutoff;
  });
}

/**
 * プロンプト用の統合コンテキスト（日付＋鮮度ルール）
 * 各generatorの先頭に挿入する推奨ブロック
 */
function buildFreshnessContext() {
  return buildTodayContext() + '\n\n' + buildFreshnessRules();
}

module.exports = {
  buildTodayContext,
  buildFreshnessRules,
  buildFreshnessContext,
  filterFreshResearch,
};
