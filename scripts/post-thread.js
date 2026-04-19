/**
 * スレッド（連投）投稿スクリプト
 *
 * 使い方:
 *   node scripts/post-thread.js --theme "テーマ" [--source file.md] [--count 6] [--cta URL] [--dry-run]
 *
 * 例:
 *   node scripts/post-thread.js --theme "キオクシア285Aの投資戦略" --source employees/logs/note-articles/kioxia-285A.md --cta https://note.com/kaizokuokabu/n/n9fa44e604bc0
 *   node scripts/post-thread.js --theme "今週の勝てるIPO3選" --count 7 --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'config', '.env'), override: true });
const fs = require('fs');
const path = require('path');
const { generateThread } = require('../lib/thread-generator');
const { postTweet, replyToTweet, uploadMedia, postTweetWithMedia } = require('../lib/x-api');
const { buildStockCard, buildComparisonCard, renderSvgToBase64 } = require('../lib/card-gen');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'post_history.json');
const THREAD_DELAY_MS = 3000; // 連投の間隔（3秒）

function readJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function executeThreadPost(tweets, theme, imageCard = null) {
  const history = readJSON(HISTORY_PATH, []);
  const threadId = `thread_${Date.now()}`;
  let rootTweetId = null;
  let lastTweetId = null;
  const postedTweets = [];

  // 画像カード生成（imageCardがあれば1本目に添付）
  let mediaIds = null;
  if (imageCard) {
    try {
      console.log(`🖼️  画像カード生成中 (${imageCard.type || 'stock'})...`);
      const svg = imageCard.type === 'comparison'
        ? buildComparisonCard(imageCard)
        : buildStockCard(imageCard);
      const base64 = renderSvgToBase64(svg);
      const mediaResult = await uploadMedia(base64);
      if (mediaResult && mediaResult.media_id_string) {
        mediaIds = [mediaResult.media_id_string];
        console.log(`  ✅ メディアID: ${mediaResult.media_id_string}`);
      }
    } catch (err) {
      console.warn(`  ⚠️ 画像添付失敗、テキストのみで続行: ${err.message}`);
    }
  }

  for (let i = 0; i < tweets.length; i++) {
    const text = tweets[i];
    console.log(`\n📤 [${i + 1}/${tweets.length}] 投稿中...`);

    try {
      const result = i === 0
        ? (mediaIds ? await postTweetWithMedia(text, mediaIds) : await postTweet(text))
        : await replyToTweet(text, lastTweetId);

      if (result && result.id) {
        console.log(`  ✅ 投稿成功: https://x.com/kaizokuokabu/status/${result.id}`);
        lastTweetId = result.id;
        if (i === 0) rootTweetId = result.id;

        postedTweets.push({
          id: `${threadId}_${i + 1}`,
          tweet_id: result.id,
          in_reply_to: i === 0 ? null : postedTweets[i - 1].tweet_id,
          text,
          theme,
          tweet_type: 'thread',
          thread_id: threadId,
          thread_position: `${i + 1}/${tweets.length}`,
          posted_at: new Date().toISOString()
        });
      } else {
        console.error(`  ❌ 投稿失敗。スレッド中断`);
        break;
      }
    } catch (err) {
      console.error(`  ❌ エラー: ${err.message}`);
      break;
    }

    if (i < tweets.length - 1) {
      await sleep(THREAD_DELAY_MS);
    }
  }

  history.push(...postedTweets);
  writeJSON(HISTORY_PATH, history);

  console.log(`\n🎉 スレッド投稿完了。${postedTweets.length}/${tweets.length}本成功`);
  if (rootTweetId) {
    console.log(`🔗 スレッドURL: https://x.com/kaizokuokabu/status/${rootTweetId}`);
  }
  return { rootTweetId, postedTweets };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  // --- --from-spec モード（事前生成JSONから投稿） ---
  if (args['from-spec']) {
    const specPath = path.isAbsolute(args['from-spec'])
      ? args['from-spec']
      : path.join(__dirname, '..', args['from-spec']);
    if (!fs.existsSync(specPath)) {
      console.error(`❌ スペックファイル見つからず: ${specPath}`);
      process.exit(1);
    }
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    console.log(`📂 スペック読込: ${specPath}`);
    console.log(`  テーマ: ${spec.theme}`);
    console.log(`  本数: ${spec.tweets.length}\n`);

    await executeThreadPost(spec.tweets, spec.theme, spec.imageCard || null);

    // 投稿済みspecはアーカイブ
    const archivePath = specPath.replace(/\.json$/, `.posted-${Date.now()}.json`);
    fs.renameSync(specPath, archivePath);
    console.log(`📦 スペックをアーカイブ: ${archivePath}`);
    return;
  }

  if (!args.theme) {
    console.error('❌ --theme は必須です');
    console.error('使い方:');
    console.error('  生成+投稿:    node scripts/post-thread.js --theme "テーマ" [--source file.md] [--count 6] [--cta URL] [--dry-run]');
    console.error('  生成+保存のみ: node scripts/post-thread.js --theme "テーマ" --save data/scheduled-threads/xxx.json [他オプション]');
    console.error('  保存分を投稿:  node scripts/post-thread.js --from-spec data/scheduled-threads/xxx.json');
    process.exit(1);
  }

  const tweetCount = parseInt(args.count || '6', 10);
  const ctaUrl = args.cta || '';
  const dryRun = args['dry-run'] === true;
  const savePath = args.save || null;

  let sourceContent = '';
  if (args.source) {
    const srcPath = path.isAbsolute(args.source)
      ? args.source
      : path.join(__dirname, '..', args.source);
    if (fs.existsSync(srcPath)) {
      sourceContent = fs.readFileSync(srcPath, 'utf-8');
      console.log(`📄 元ネタ読込: ${srcPath} (${sourceContent.length}字)`);
    } else {
      console.warn(`⚠️  ソースファイル見つからず: ${srcPath}`);
    }
  }

  const mode = savePath ? `SAVE（${savePath}）` : dryRun ? 'DRY RUN（投稿しない）' : '本番投稿';
  console.log(`\n🧵 スレッド生成開始`);
  console.log(`  テーマ: ${args.theme}`);
  console.log(`  本数: ${tweetCount}`);
  console.log(`  CTA: ${ctaUrl || '（なし）'}`);
  console.log(`  モード: ${mode}\n`);

  const tweets = await generateThread({
    theme: args.theme,
    sourceContent,
    tweetCount,
    ctaUrl
  });

  console.log(`✅ ${tweets.length}本のツイートを生成\n`);
  tweets.forEach((t, i) => {
    console.log(`--- [${i + 1}/${tweets.length}] (${t.length}字) ---`);
    console.log(t);
    console.log();
  });

  if (savePath) {
    const absSave = path.isAbsolute(savePath) ? savePath : path.join(__dirname, '..', savePath);
    const dir = path.dirname(absSave);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const spec = {
      theme: args.theme,
      ctaUrl,
      tweets,
      generated_at: new Date().toISOString()
    };
    writeJSON(absSave, spec);
    console.log(`\n💾 スペック保存完了: ${absSave}`);
    console.log(`   発火時は: node scripts/post-thread.js --from-spec ${savePath}`);
    return;
  }

  if (dryRun) {
    console.log(`\n🔍 DRY RUN 終了。本番投稿する場合は --dry-run を外してください`);
    return;
  }

  await executeThreadPost(tweets, args.theme);
}

main().catch(err => {
  console.error('❌ 致命的エラー:', err.message);
  process.exit(1);
});
