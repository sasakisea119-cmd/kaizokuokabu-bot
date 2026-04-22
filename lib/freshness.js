/**
 * 投稿鮮度ユーティリティ
 * - 全投稿生成器で共有する「今日の日付」「鮮度ルール」を集約
 * - research_pool の古いネタをフィルタ（デフォルト1日以内）
 * - 投稿直前に具体数値の鮮度をチェックする guardFreshness()
 *
 * 株式投資の投稿は「当日の情報」であることが極めて重要。
 * Anthropicモデルは学習データカットオフ以降の株価や日付を知らないため、
 * 具体的な株価・日付を出すと必ずズレる。
 * よって、時間表現は「相対表現」に統一し、絶対日付は動的に注入する。
 *
 * 【社長方針】インプットにする数値情報は1日前までのものをベースとする。
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

  // 昨日の日付（1日前基準データの参考情報として）
  const y = new Date(jst.getTime() - 24 * 3600 * 1000);
  const yisoStr = y.toISOString().slice(0, 10);

  let timeOfDay;
  if (hour >= 5 && hour < 11) timeOfDay = '朝（寄り前〜寄り付き直後）';
  else if (hour >= 11 && hour < 15) timeOfDay = '日中（前場〜後場）';
  else if (hour >= 15 && hour < 18) timeOfDay = '大引け後（夕方）';
  else if (hour >= 18 && hour < 23) timeOfDay = '夜（市場クローズ後）';
  else timeOfDay = '深夜〜早朝';

  return `## 現在時刻（必読・絶対遵守）
本日: ${yyyy}年${mm}月${dd}日（${weekday}）JST
時間帯: ${timeOfDay}
許容データ基準日: ${yisoStr}（昨日）以降の取得データのみ使用可

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

### 🚨 最重要：数値情報は「1日前まで」のデータのみ使用可
- 投稿に盛り込む全ての具体数値（株価・指数・時価総額・配当利回り・PER等）は**「昨日以降に取得したデータ」**でなければならない
- 学習データから記憶で数字を書くことを**完全に禁止**する（モデルの学習データは古く、現在の相場と必ずズレる）
- 本日・昨日のデータが取れない場合は、**具体数値を諦めて定性表現に切り替える**

### 時間表現の統一
- ❌ NG: 「2025年◯月」「2024年◯月」など**絶対日付**（本日とのズレで古さが露呈する）
- ✅ OK: 「先月」「去年」「今週」「来週」「昨日の引け」など**相対表現**
- ❌ NG: 過去イベントに対して「今度」「来週」など未来形を使うこと

### 株価・業績数字の扱い
- ❌ NG: 「日経平均 37,438円」「アストロスケール 1,489円」のような**具体的な円数**（古い学習データから出ると必ずズレる）
- ✅ OK: 「日経 高値圏もみ合い」「年初来安値タッチ」「PBR1倍割れ」などの**定性表現**
- ✅ OK: 「PER 11倍」「配当利回り 4%超」「前日比 +1.2%」のような**鮮度に依存しない相対指標**
- ✅ OK: 変化率・倍率（「+20%」「3倍上昇」）は過去からの変化なので問題なし

### 銘柄コード
- 証券コードは必ず4桁数字（または3桁+英字）で明記（例：東京エレクトロン（8035））
- 銘柄名はよく知られた略称+コードで

### IPO・決算スケジュール
- 上場日・決算日などの具体日付はresearch_poolで明示提供されたもの以外は使わない
- 不明な場合は「今月中の上場」「来週の決算」など相対表現で

### 許容される具体数字
- 指数・株価は「〜円台」「〜ポイント台」で幅を持たせる（ただしその水準が現実と乖離しないよう web_searchで確認）
- PBR/PER/配当利回りは「1倍割れ」「10倍台」「4%超」など幅でOK
- 過去イベントの「+20%」「-30%」のような変化率は可`;
}

/**
 * research_poolから鮮度の高いネタのみをフィルタ
 * @param {Array} pool - research_pool.json
 * @param {Object} opts
 * @param {number} opts.maxAgeDays - 許容最大日数（デフォルト1日 = 社長方針）
 * @returns {Array} - 鮮度の高いネタのみ
 */
function filterFreshResearch(pool, opts = {}) {
  const maxAgeDays = opts.maxAgeDays || 1;
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
 */
function buildFreshnessContext() {
  return buildTodayContext() + '\n\n' + buildFreshnessRules();
}

// ============================================================
// 投稿直前のガード（社長指示：Aの実装、1日前基準）
// ============================================================

/**
 * テキスト内の「具体的な株価・指数（円）」パターンを検出する
 * こういう具体的な円数は学習データ由来のズレリスクが高いので検出対象
 * @param {string} text
 * @returns {Array<{match:string, type:string}>}
 */
function detectConcretePrices(text) {
  const detected = [];
  const patterns = [
    // 日経平均 37,438円 / 日経 59,500円 / 日経平均37438
    { re: /日経(平均)?[^\d]{0,4}(\d{2},?\d{3})\s*円/g, type: 'nikkei_price' },
    // TOPIX 2,803 / TOPIX 2,803.25
    { re: /TOPIX[^\d]{0,4}(\d{1,2},?\d{3}(\.\d+)?)/g, type: 'topix_value' },
    // 銘柄名(XXXX) YYY円 ＝ (6525) 8,500円 のような具体株価
    { re: /（?\(?\s*\d{3,4}[A-Z]?\s*\)?）?[^\d]{0,8}(\d{1,3},?\d{3})\s*円/g, type: 'stock_price_with_code' },
    // 時価総額 16.7兆円 など（動きやすい指標）
    { re: /時価総額[^\d]{0,4}(\d+(\.\d+)?)\s*兆円/g, type: 'market_cap_trillion' },
    // 4桁以上の具体円（単独で登場するパターン、株価であることが多い）※誤検出多めなので type=unknown
    // この項目は生成者側への示唆用。strict判定では使わない
  ];
  for (const { re, type } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      detected.push({ match: m[0].trim(), type });
    }
  }
  return detected;
}

/**
 * 投稿直前の鮮度ガード
 * 具体数値が含まれている場合、直近24h以内に生成された投稿か（research_pool由来か）を確認。
 * 「古いデータ由来の疑い」があれば warning を返す。
 *
 * @param {string} text - 投稿予定テキスト
 * @param {Object} opts
 * @param {Array} opts.recentHistory - 直近のpost_history（同じ数値が繰り返し出ていないか確認用）
 * @param {boolean} opts.strict - true なら具体数値検出だけで投稿を止める（デフォルトfalse）
 * @returns {{ok:boolean, reason?:string, warnings?:Array}}
 */
function guardFreshness(text, opts = {}) {
  const { recentHistory = [], strict = false } = opts;
  const concrete = detectConcretePrices(text);
  if (concrete.length === 0) {
    return { ok: true };
  }

  // 直近24時間の投稿履歴で「全く同じ具体数値」が出ていたら、古いデータ使い回しの疑い
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recentTexts = (recentHistory || [])
    .filter(h => new Date(h.posted_at || 0).getTime() >= dayAgo)
    .map(h => h.text || '');

  const suspicious = [];
  for (const c of concrete) {
    // 数値部分だけ取り出す
    const numberMatch = c.match.match(/[\d,\.]+/);
    if (!numberMatch) continue;
    const num = numberMatch[0];
    // 同じ数値が直近で出ていた→使い回しの疑い
    for (const rt of recentTexts) {
      if (rt.includes(num)) {
        suspicious.push({ match: c.match, type: c.type, reason: 'recent_duplicate' });
        break;
      }
    }
  }

  const warnings = concrete.map(c => ({
    match: c.match,
    type: c.type,
    severity: suspicious.find(s => s.match === c.match) ? 'high' : 'low',
  }));

  // 高警戒度が存在、またはstrictモードで具体数値が1つでもあれば NG
  const shouldBlock = strict || warnings.some(w => w.severity === 'high');

  if (shouldBlock) {
    return {
      ok: false,
      reason: `具体数値の鮮度リスク検出 (${warnings.length}件): ${warnings.map(w => w.match).join(', ')}`,
      warnings,
    };
  }

  // 警告のみ（投稿は許可）
  return {
    ok: true,
    reason: `具体数値検出 (${warnings.length}件): ${warnings.map(w => w.match).join(', ')} — 鮮度要確認`,
    warnings,
  };
}

/**
 * 標準出力に整形してログ出力するヘルパー
 * @param {string} source - 呼び出し元（'post-short', 'poster' など）
 * @param {string} text
 * @param {Array} recentHistory
 * @returns {{ok:boolean, blocked:boolean}}
 */
function logAndGuardFreshness(source, text, recentHistory) {
  const result = guardFreshness(text, { recentHistory, strict: false });
  if (!result.warnings || result.warnings.length === 0) return { ok: true, blocked: false };

  const hasHigh = result.warnings.some(w => w.severity === 'high');
  if (hasHigh) {
    console.error(`\n⚠️ [${source}] 鮮度ガード: ${result.reason}`);
    console.error(`   → 投稿をスキップします（高警戒度: 直近投稿と同じ具体数値）`);
    return { ok: false, blocked: true };
  }

  console.warn(`\n⚠️ [${source}] 鮮度ガード: ${result.reason}`);
  console.warn(`   → 投稿は継続（低警戒度: 新規の具体数値）。社長は結果を確認してください。`);
  return { ok: true, blocked: false };
}

module.exports = {
  buildTodayContext,
  buildFreshnessRules,
  buildFreshnessContext,
  filterFreshResearch,
  detectConcretePrices,
  guardFreshness,
  logAndGuardFreshness,
};
