require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { quoteTweet } = require('../lib/x-api');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DATA_DIR = path.join(__dirname, '..', 'data');
const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');

function readJSON(filePath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function isKillSwitchOn() {
  return fs.existsSync(path.join(DATA_DIR, 'KILL_SWITCH'));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('[retweeter] 引用リツイート開始...');

  if (isKillSwitchOn()) {
    console.log('[retweeter] KILL_SWITCHが有効です。中止します。');
    return;
  }

  const candidatesPath = path.join(DATA_DIR, 'retweet_candidates.json');
  let candidates = readJSON(candidatesPath);

  if (candidates.length === 0) {
    console.log('[retweeter] retweet_candidates.jsonにツイートIDを追加してください。');
    writeJSON(candidatesPath, []);
    return;
  }

  const persona = readJSON(path.join(KNOWLEDGE_DIR, 'persona.json'), {});
  const historyPath = path.join(DATA_DIR, 'retweet_history.json');
  const rtHistory = readJSON(historyPath);

  // 今日の引用RT数をチェック
  const today = new Date().toISOString().split('T')[0];
  const todayCount = rtHistory.filter(r => r.quoted_at?.startsWith(today)).length;
  const remaining = Math.max(0, 5 - todayCount);

  if (remaining === 0) {
    console.log('[retweeter] 本日の引用RT上限（5件）に達しています。');
    return;
  }

  const toProcess = candidates.slice(0, remaining);
  let processed = 0;

  for (const candidate of toProcess) {
    if (isKillSwitchOn()) {
      console.log('[retweeter] KILL_SWITCHが有効になりました。中止します。');
      break;
    }

    try {
      // コメント生成
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: `以下のツイートIDの投稿に対する引用リツイートのコメントを生成してください。
ツイートの文脈：${candidate.context}

コメントの条件：
- 50〜120文字程度
- 独自の分析・見解・補足のいずれかを添える
- 口調：${persona.tone?.style || '丁寧だが歯切れのいい分析者'}
- データや数字を入れるとなお良い
- 「これは面白い」「同意」だけのコメントはNG。必ず付加価値のある内容にする
- バズることを意識（スクロールを止める1行目）
- 特定銘柄の「買い推奨」「売り推奨」はしない

コメントのテキストだけを出力してください。`
        }],
        system: `あなたはX（旧Twitter）の投資アカウント「kaizokuokabu」です。\nペルソナ:\n${JSON.stringify(persona, null, 2)}`
      });

      const comment = response.content[0].text.trim();
      console.log(`  [retweeter] コメント生成: ${comment.substring(0, 50)}...`);

      // 引用リツイート実行
      const result = await quoteTweet(comment, candidate.tweet_id);

      if (result) {
        rtHistory.push({
          tweet_id: result.id,
          quoted_tweet_id: candidate.tweet_id,
          comment,
          context: candidate.context,
          quoted_at: new Date().toISOString()
        });
        processed++;
        console.log(`  [retweeter] 引用RT成功: ${result.id}`);
      }
    } catch (err) {
      console.error(`  [retweeter] エラー（${candidate.tweet_id}）: ${err.message}`);
    }

    // 10秒間隔
    if (toProcess.indexOf(candidate) < toProcess.length - 1) {
      await sleep(10000);
    }
  }

  // 処理済み候補を削除
  const processedIds = toProcess.slice(0, processed).map(c => c.tweet_id);
  candidates = candidates.filter(c => !processedIds.includes(c.tweet_id));
  writeJSON(candidatesPath, candidates);
  writeJSON(historyPath, rtHistory);

  console.log(`[retweeter] 完了: ${processed}件引用RT`);

  // TODO: 将来のアップグレード
  // X API v2の検索エンドポイント（有料プラン）が使えるようになったら、
  // バズツイートの自動検索＋自動引用RTに進化させる。
  // 現時点では手動でtweet_idを入れる運用。
}

module.exports = { run };

if (require.main === module) {
  run().catch(console.error);
}
