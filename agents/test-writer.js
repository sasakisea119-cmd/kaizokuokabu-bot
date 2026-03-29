const fs = require('fs');
const path = require('path');
const { createWithRetry } = require('../lib/anthropic-client');
const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');
const DATA_DIR = path.join(__dirname, '..', 'data');

function readJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function main() {
  console.log('[test-writer] テスト投稿生成（1本のみ、投稿しません）\n');

  const persona = readJSON(path.join(KNOWLEDGE_DIR, 'persona.json'), {});
  const patterns = readJSON(path.join(KNOWLEDGE_DIR, 'patterns.json'), { patterns: [] });
  const hooks = readJSON(path.join(KNOWLEDGE_DIR, 'hooks.json'), { hooks: [] });
  const buzzRef = readJSON(path.join(KNOWLEDGE_DIR, 'buzz_references.json'), {});

  // ランダムにパターンとフックを選択
  const pattern = patterns.patterns[Math.floor(Math.random() * patterns.patterns.length)];
  const hook = hooks.hooks[Math.floor(Math.random() * hooks.hooks.length)];
  const themes = persona.themes?.main_categories || [];
  const theme = themes[Math.floor(Math.random() * themes.length)];

  console.log(`  パターン: ${pattern.id} - ${pattern.name}`);
  console.log(`  フック:   ${hook.id} - ${(hook.structure || hook.template || '').substring(0, 40)}...`);
  console.log(`  テーマ:   ${theme}\n`);

  const systemPrompt = `あなたはX（旧Twitter）の投資アカウント「kaizokuokabu」として投稿を作成するAIです。

## ペルソナ
${JSON.stringify(persona, null, 2)}

## virality_principles
${JSON.stringify(persona.virality_principles, null, 2)}

## 今回使用するパターン
${JSON.stringify(pattern, null, 2)}

## 今回使用するフック
${JSON.stringify(hook, null, 2)}

## バズ戦略
${JSON.stringify(buzzRef.virality_strategy, null, 2)}

## 構造パターン
${JSON.stringify(buzzRef.structural_patterns, null, 2)}

## ルール
- 280文字以内（厳守）
- 免責文は不要（プロフィールに記載済み）
- ハッシュタグは0〜2個
- 数字を必ず含める
- 1行目でスクロールを止めさせる
- バズることを最優先に。感情を揺さぶる＋データで裏付ける構成にして
- 特定銘柄の「買い推奨」「売り推奨」はしない

投稿テキストだけを出力してください。`;

  const response = await createWithRetry({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: `テーマ「${theme}」で投稿を1本生成してください。` }],
    system: systemPrompt
  });

  const postText = response.content[0].text.trim();

  // 採点
  const scoreResponse = await createWithRetry({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `以下の投稿を10項目×10点で採点。JSON形式で。

投稿：
${postText}

項目：バズ力、フック力、有益性、データ具体性、独自性、議論誘発力、保存したくなるか、テンポ、ペルソナ一致、NGワード非含有

形式：{"scores":{"buzz":X,"hook":X,"value":X,"data":X,"unique":X,"discussion":X,"bookmark":X,"tempo":X,"persona":X,"ng_check":X},"average":X.X}`
    }],
    system: 'JSONのみ出力。'
  });

  let scoreData;
  try {
    const jsonMatch = scoreResponse.content[0].text.match(/\{[\s\S]*\}/);
    scoreData = JSON.parse(jsonMatch[0]);
  } catch {
    scoreData = { average: '?', scores: {} };
  }

  console.log('─'.repeat(50));
  console.log('  生成された投稿:');
  console.log('─'.repeat(50));
  console.log(`\n  ${postText}\n`);
  console.log('─'.repeat(50));
  console.log(`  文字数: ${postText.length}/280`);
  console.log(`  平均スコア: ${scoreData.average}`);
  if (scoreData.scores) {
    console.log(`  詳細: ${JSON.stringify(scoreData.scores)}`);
  }
  console.log(`  判定: ${scoreData.average >= 7.0 ? 'PASS' : 'FAIL（7.0未満）'}`);
  console.log('─'.repeat(50));
  console.log('\n  ※ このテストでは投稿は実行されません。');
}

main().catch(console.error);
