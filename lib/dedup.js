/**
 * 投稿重複検出ユーティリティ
 * - 直近N時間のpost_historyに対して類似テキストをチェック
 * - 「先頭30字完全一致」または「Jaccard類似度0.6以上」を重複と判定
 */
const DEFAULT_HOURS = 48;

function normalize(text) {
  return (text || '')
    .replace(/https?:\/\/\S+/g, '')         // URL除去
    .replace(/[\s\u3000]+/g, '')             // 空白・全角スペース除去
    .replace(/[#＃]\S+/g, '')                 // ハッシュタグ除去
    .replace(/[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}]/gu, '') // 絵文字除去
    .toLowerCase();
}

function ngrams(text, n = 3) {
  const set = new Set();
  for (let i = 0; i + n <= text.length; i++) {
    set.add(text.slice(i, i + n));
  }
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 過去履歴と類似する投稿を探す
 * @param {string} candidateText
 * @param {Array<{text:string, posted_at:string}>} history
 * @param {Object} opts
 * @param {number} opts.hours - 何時間前まで遡るか（デフォルト48h）
 * @param {number} opts.headChars - 先頭一致に使う文字数（デフォルト30）
 * @param {number} opts.threshold - Jaccard類似度の閾値（デフォルト0.6）
 * @returns {{isDuplicate:boolean, reason:string, matched?:Object}}
 */
function findDuplicate(candidateText, history, opts = {}) {
  const hours = opts.hours || DEFAULT_HOURS;
  const headChars = opts.headChars || 30;
  const threshold = opts.threshold ?? 0.6;

  const cutoff = Date.now() - hours * 3600 * 1000;
  const cand = normalize(candidateText);
  if (!cand) return { isDuplicate: false, reason: 'empty' };
  const candHead = cand.slice(0, headChars);
  const candGrams = ngrams(cand);

  for (const h of history) {
    const ts = new Date(h.posted_at || h.created_at || 0).getTime();
    if (!ts || ts < cutoff) continue;
    const past = normalize(h.text);
    if (!past) continue;
    if (past.slice(0, headChars) === candHead) {
      return { isDuplicate: true, reason: `head_match (${headChars}字一致)`, matched: h };
    }
    const sim = jaccard(candGrams, ngrams(past));
    if (sim >= threshold) {
      return { isDuplicate: true, reason: `similarity ${(sim * 100).toFixed(0)}%`, matched: h };
    }
  }

  return { isDuplicate: false, reason: 'unique' };
}

module.exports = { findDuplicate, normalize };
