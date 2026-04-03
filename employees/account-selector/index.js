/**
 * 社員1: アカウントセレクター（account-selector）
 * Grok x_search で投資クラスタの交流すべきアカウントを自動選定
 * 出力: data/target_accounts.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { searchX } = require('../../lib/grok-client');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TARGET_FILE = path.join(DATA_DIR, 'target_accounts.json');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'account-selector.log');
const MAX_ACCOUNTS = 20;
const COOLDOWN_DAYS = 7; // 同一アカウント再選定禁止期間

/**
 * ログ書き込み
 */
function log(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  console.log(line.trim());
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* ignore */ }
}

/**
 * 既存のターゲットアカウントを読み込み
 */
function loadExisting() {
  try {
    if (fs.existsSync(TARGET_FILE)) {
      return JSON.parse(fs.readFileSync(TARGET_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * クールダウン中のアカウント名を取得
 */
function getCooldownUsernames(existing) {
  const cutoff = Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return new Set(
    existing
      .filter(a => new Date(a.selected_at).getTime() > cutoff)
      .map(a => a.username.toLowerCase().replace('@', ''))
  );
}

/**
 * Grok x_search でアクティブな投資アカウントを検索
 */
async function searchInvestmentAccounts() {
  const queries = [
    // 日本株系
    `日本語で投資や株について毎日投稿しているアクティブなXアカウントを10個教えてください。` +
    `フォロワー1,000〜50,000の中規模アカウントが理想です。` +
    `各アカウントについて以下をJSON形式で出力してください：` +
    `username, followers(概算), reason(なぜ交流すべきか), investment_style(投資スタイル)。` +
    `詐欺・情報商材・「月収100万」系は除外してください。`,

    // 米国株・マクロ系
    `米国株やマクロ経済について日本語で発信しているXアカウントを5個教えてください。` +
    `フォロワー1,000〜50,000の中規模アカウントで、毎日投稿しているアクティブなアカウントが理想です。` +
    `各アカウントについて以下をJSON形式で出力してください：` +
    `username, followers(概算), reason(なぜ交流すべきか), investment_style(投資スタイル)。` +
    `詐欺・情報商材系は除外してください。`,
  ];

  const results = [];

  for (const query of queries) {
    try {
      log(`検索中: ${query.substring(0, 50)}...`);
      const text = await searchX(query, 48);
      const parsed = parseAccountsFromText(text);
      results.push(...parsed);
      // レートリミット対策
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      log(`検索エラー: ${err.message}`);
    }
  }

  return results;
}

/**
 * Grok応答テキストからアカウント情報を抽出
 */
function parseAccountsFromText(text) {
  const accounts = [];

  // JSONブロックを探す
  const jsonMatches = text.match(/\{[^{}]*"username"[^{}]*\}/g);
  if (jsonMatches) {
    for (const jsonStr of jsonMatches) {
      try {
        const obj = JSON.parse(jsonStr);
        if (obj.username) {
          accounts.push({
            username: obj.username.startsWith('@') ? obj.username : `@${obj.username}`,
            followers: obj.followers || 0,
            reason: obj.reason || '',
            investment_style: obj.investment_style || '',
          });
        }
      } catch { /* JSONパース失敗は無視 */ }
    }
  }

  // JSON抽出できなかった場合、@username パターンで抽出
  if (accounts.length === 0) {
    const usernamePattern = /@(\w{1,15})/g;
    let match;
    while ((match = usernamePattern.exec(text)) !== null) {
      const username = `@${match[1]}`;
      // 明らかにアカウントでない単語を除外
      const skipWords = ['gmail', 'yahoo', 'hotmail', 'outlook', 'example'];
      if (!skipWords.some(w => match[1].toLowerCase().includes(w))) {
        if (!accounts.find(a => a.username.toLowerCase() === username.toLowerCase())) {
          // 周辺テキストからコンテキストを取得
          const start = Math.max(0, match.index - 50);
          const end = Math.min(text.length, match.index + 100);
          const context = text.substring(start, end).replace(/\n/g, ' ').trim();

          accounts.push({
            username,
            followers: 0,
            reason: context,
            investment_style: '',
          });
        }
      }
    }
  }

  return accounts;
}

/**
 * アカウントの優先度を判定
 */
function assignPriority(account) {
  const f = account.followers;
  if (f >= 5000 && f <= 30000) return 'high';
  if (f >= 1000 && f <= 50000) return 'medium';
  return 'low';
}

/**
 * メイン実行
 */
async function run() {
  log('=== account-selector 開始 ===');

  // 既存データ読み込み
  const existing = loadExisting();
  const cooldown = getCooldownUsernames(existing);
  log(`クールダウン中: ${cooldown.size}アカウント`);

  // Grok検索でアカウント候補取得
  const candidates = await searchInvestmentAccounts();
  log(`候補取得: ${candidates.length}アカウント`);

  // フィルタリング
  const filtered = candidates.filter(a => {
    const name = a.username.toLowerCase().replace('@', '');
    // クールダウン中は除外
    if (cooldown.has(name)) {
      log(`スキップ（クールダウン中）: ${a.username}`);
      return false;
    }
    // 自分自身は除外
    if (name === 'kaizokuokabu') return false;
    return true;
  });

  // 重複除去
  const unique = [];
  const seen = new Set();
  for (const a of filtered) {
    const key = a.username.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(a);
    }
  }

  // 上限適用＋優先度付与
  const selected = unique.slice(0, MAX_ACCOUNTS).map(a => ({
    ...a,
    priority: assignPriority(a),
    selected_at: new Date().toISOString(),
  }));

  log(`選定完了: ${selected.length}アカウント`);

  // 保存（過去データと結合）
  const merged = [...selected, ...existing];
  // 最大100件保持（古いものから削除）
  const trimmed = merged.slice(0, 100);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TARGET_FILE, JSON.stringify(trimmed, null, 2));
  log(`保存完了: ${TARGET_FILE}`);

  // サマリー出力
  const summary = {
    total_selected: selected.length,
    high: selected.filter(a => a.priority === 'high').length,
    medium: selected.filter(a => a.priority === 'medium').length,
    low: selected.filter(a => a.priority === 'low').length,
    total_in_file: trimmed.length,
  };
  log(`サマリー: ${JSON.stringify(summary)}`);
  log('=== account-selector 完了 ===');

  return selected;
}

// CLI実行
if (require.main === module) {
  run().then(result => {
    console.log(`\n✅ ${result.length}アカウントを選定しました`);
  }).catch(err => {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { run };
