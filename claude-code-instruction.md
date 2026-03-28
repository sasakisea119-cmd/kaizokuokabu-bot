# ========================================
# Claude Code 指示文：X投資アカウント（kaizokuokabu）完全自動化
# フェーズ1〜3 一括構築
# ========================================

CLAUDE.mdを読んで全体像を把握してください。
knowledgeフォルダにナレッジ4ファイル、config/.envにAPIキー、data/に初期ファイルが入っています。

X（旧Twitter）の投資アカウント「kaizokuokabu」を完全自動化します。
**最優先方針：バズらせてインプレッションを最大化すること。**

以下の手順を順番に実行してください。

---

## 手順1：プロジェクト初期化

package.jsonを作成してNode.jsプロジェクトとして初期化。以下をインストール：
- dotenv
- @anthropic-ai/sdk

data/logs/ ディレクトリを作成。

---

## 手順2：lib/x-api.js を作成

X API v2の共通ユーティリティ。OAuth 1.0a署名を自前で実装。

### エクスポートする関数：

```javascript
module.exports = {
  // ツイートを投稿。成功時: { id, text }、失敗時: null
  postTweet: async function(text) { ... },

  // 引用リツイート（コメント付き）。成功時: { id, text }、失敗時: null
  quoteTweet: async function(text, quoteTweetId) { ... },

  // ツイートのメトリクス取得。成功時: { impressions, likes, retweets, replies }
  getTweetMetrics: async function(tweetId) { ... }
};
```

### OAuth 1.0a署名の実装：
- POST/GETリクエストに対してOAuth 1.0a署名を生成するヘルパー関数を作る
- Node.js組み込みの crypto モジュールを使用
- oauth_nonce: crypto.randomBytes(32).toString('hex')
- oauth_timestamp: Math.floor(Date.now() / 1000).toString()
- signature base string: METHOD&percentEncode(URL)&percentEncode(params sorted alphabetically)
- signing key: percentEncode(consumer_secret)&percentEncode(token_secret)
- signature: crypto.createHmac('sha1', signingKey).update(baseString).digest('base64')
- percent encoding: encodeURIComponent()をベースに、RFC 3986準拠で !*'() も変換
- Authorizationヘッダー: OAuth oauth_consumer_key="...", oauth_nonce="...", oauth_signature="...", oauth_signature_method="HMAC-SHA1", oauth_timestamp="...", oauth_token="...", oauth_version="1.0"

### APIエンドポイント：
- 投稿: POST https://api.x.com/2/tweets  body: { "text": "..." }  Content-Type: application/json
- 引用リツイート: POST https://api.x.com/2/tweets  body: { "text": "コメント", "quote_tweet_id": "元ツイートID" }  ※通常の投稿と同じエンドポイント。quote_tweet_idを追加するだけ
- メトリクス: GET https://api.x.com/2/tweets/{id}?tweet.fields=public_metrics
- 自分の情報: GET https://api.x.com/2/users/me

### 重要な注意：
- POSTでJSON bodyを送る場合、bodyのパラメータはOAuth署名のbase stringには含めない（クエリパラメータのみ含める）
- Content-Type: application/json を必ずヘッダーに含める
- .envから X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET を読み込む

---

## 手順3：agents/writer.js を作成

### 仕様：
- 280文字以内で投稿を生成（Xの制限）
- **免責文は不要**（プロフィールに記載済み）
- ハッシュタグは0〜2個（多すぎるとスパム扱い）
- バズを最優先で設計（persona.jsonのvirality_principlesを参照）

### 処理フロー：
1. knowledge/4ファイル＋data/post_history.json読み込み
2. data/analyst_feedback.jsonがあれば読み込み（なければスキップ）
3. data/research_pool.jsonがあればネタ取得（なければスキップ）
4. パターン選択（直近3件と被らない）
5. フック選択（直近5件と被らない）
6. テーマ選択（3回連続禁止）
7. Anthropic API（claude-sonnet-4-20250514）で投稿生成
   - システムプロンプトに含めるもの：
     - persona.jsonの全内容（特にvirality_principles）
     - 選択パターンと選択フック
     - buzz_references.jsonのvirality_strategyとstructural_patterns
     - research_poolから取得したネタ（あれば）
     - analyst_feedbackの推奨（あれば）
   - 「280文字以内」「免責文不要」「数字を必ず含める」「1行目でスクロールを止めさせる」を指示
   - 「バズることを最優先に。感情を揺さぶる＋データで裏付ける構成にして」と指示
8. 自己採点（10項目×10点）
   - バズ力（リツイートされそうか）、フック力、有益性、データ具体性、独自性、議論誘発力、保存したくなるか、テンポ、ペルソナ一致、NGワード非含有
   - 平均7.0未満→書き直し（最大2リトライ）
9. 過去100件との簡易類似度チェック
10. 合格投稿をqueue.jsonに追加
11. 1回で5本生成

### モジュール化：run()エクスポート＋直接実行対応

---

## 手順4：agents/poster.js を作成

### 処理フロー：
1. KILL_SWITCHチェック
2. queue.jsonから最古の1件取得
3. lib/x-api.jsのpostTweet()で投稿
4. 成功→post_history.jsonに記録、queueから削除
5. 失敗→エラーログ

### エラーハンドリング：
- 401→「APIキー確認」
- 403→「Read and write権限確認」
- 429→「レートリミット」
- 187（重複投稿）→「同じ内容の投稿が既にあります」→queueから削除

### モジュール化：postOne()エクスポート＋直接実行対応

---

## 手順5：agents/retweeter.js を作成（新規）

投資クラスタでバズっているツイートに独自コメントを付けて引用リツイートするエージェント。
**普通のリツイートではなく、引用リツイート（Quote Tweet）を行う。自分の分析・見解コメントを必ず添える。**

### 処理フロー：
1. KILL_SWITCHチェック
2. data/retweet_candidates.json を読み込む
   - 形式: [{ "tweet_id": "xxx", "context": "半導体決算速報で注目" }]
   - このファイルに手動でバズツイートのIDを入れておく運用
   - ファイルがなければ空配列で初期化して「retweet_candidates.jsonにツイートIDを追加してください」とログ出力して終了

3. 各候補について、Anthropic API（Claude Sonnet）で引用コメントを生成：
   - 「以下のツイートIDの投稿に対する引用リツイートのコメントを生成してください。
     ツイートの文脈：{context}
     
     コメントの条件：
     - 50〜120文字程度
     - 独自の分析・見解・補足のいずれかを添える
     - persona.jsonの口調に合わせる
     - データや数字を入れるとなお良い
     - 「これは面白い」「同意」だけのコメントはNG。必ず付加価値のある内容にする
     - バズることを意識（スクロールを止める1行目）
     
     コメントのテキストだけを出力してください。」

4. lib/x-api.js の quoteTweet(comment, tweetId) で引用リツイート実行
   - quoteTweet関数の実装：POST https://api.x.com/2/tweets  body: { "text": コメント, "quote_tweet_id": ツイートID }
   - postTweetとほぼ同じだがbodyにquote_tweet_idが追加される

5. 成功したらdata/retweet_history.jsonに記録（ツイートID、コメント、日時）
6. 処理済みの候補をretweet_candidates.jsonから削除
7. 1件ごとに10秒間隔
8. 1日5件まで

### 将来のアップグレード（今は実装しない、コメントだけ残す）：
- X API v2の検索エンドポイント（有料プラン）が使えるようになったら、バズツイートの自動検索＋自動引用RTに進化させる
- 現時点では手動でtweet_idを入れる運用

### モジュール化対応

---

## 手順6：agents/fetcher.js を作成

- post_history.jsonの投稿から24時間以上経過＋メトリクス未取得のものを抽出
- lib/x-api.jsのgetTweetMetrics()で取得
- post_history.jsonに追記（impressions, likes, retweets, replies, fetched_at）
- 2秒間隔

### モジュール化対応

---

## 手順7：agents/analyst.js を作成

- メトリクス取得済み10件以上で分析実行
- Anthropic APIでパフォーマンス分析：パターン別、テーマ別、フック別、時間帯別
- **特にインプレッション数を最重視して分析**
- 「どんな投稿がバズったか」「どうすればもっとインプが伸びるか」にフォーカス
- data/analyst_feedback.jsonに保存

### モジュール化対応

---

## 手順8：agents/researcher.js を作成

**このエージェントが最も重要。最新情報を収集してネタの鮮度を保つ。**

### 処理フロー：
1. persona.jsonのテーマカテゴリを読み込む
2. data/research_pool.jsonを読み込み（なければ初期化）
3. Anthropic API（Claude Sonnet）にWeb検索ツールを使わせて最新情報を収集

### 収集する情報（2種類）：

**A. 国内の最新投資ニュース**
Anthropic APIに以下を指示（web_searchツールを有効化して）：
「以下のテーマについて、今日の最新ニュースをWeb検索して、投稿ネタになりそうな情報を収集してください：
- 日本株市場の動向
- 注目の決算発表
- 日銀の金融政策
- 日本の経済指標
- 注目のIPO
- テーマ投資（半導体、AI、防衛、原子力、宇宙）の国内動向

各ニュースについて以下をJSON形式で出力：
- title: ニュースのタイトル
- summary: 要約（2〜3文）
- investment_angle: 投資家目線での分析ポイント
- recommended_pattern: 投稿パターンID
- urgency: "high"（速報性あり）/ "medium" / "low"
」

**B. 海外の最新投資ニュース**
同様にWeb検索で：
「以下のテーマについて、今日の海外最新ニュースをWeb検索して収集：
- 米国株市場（S&P500, NASDAQ）
- FRBの金融政策
- 米国の主要企業決算（FAANG, 半導体等）
- 地政学リスク（米中、中東等の市場影響）
- グローバルなテーマ投資トレンド
- 暗号資産・新興市場の動向
」

**C. 今Xでバズっている投資系の話題**
Web検索で：
「X（Twitter）の投資クラスタで今バズっている話題、トレンドになっている銘柄やテーマを検索してください。
日本語の投資系ツイートで話題になっていること、議論になっていることを5個挙げてください。」

4. 収集した情報をdata/research_pool.jsonに追加
   - 形式: { id, theme, title, summary, investment_angle, recommended_pattern, urgency, source_type("domestic"/"international"/"trending"), created_at, used: false }
5. urgency="high"のネタがあれば「🔥 速報ネタあり」とログ出力

### Anthropic APIでのWeb検索の実装方法：
- Anthropic SDKのmessages.createでtoolsパラメータにweb_searchツールを指定：
```javascript
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 4096,
  tools: [{ type: "web_search_20250305", name: "web_search" }],
  messages: [{ role: "user", content: "..." }]
});
```
- レスポンスのcontent配列からtextブロックを抽出してJSON解析

### モジュール化対応

---

## 手順9：agents/supervisor.js を作成

### チェック項目：
- A. 投稿頻度チェック（24時間でオリジナル投稿8件超 or 引用RT含め合計15件超→WARNING）
- B. 投稿間隔チェック（30分未満→CRITICAL→KILL_SWITCH）
- C. 品質スコアチェック（直近10件平均6.5未満→WARNING）
- D. パターン/テーマ偏りチェック
- E. キュー残量チェック
- F. エラー連続チェック（3連続→CRITICAL→KILL_SWITCH）
- G. 月間投稿数チェック（400件超→WARNING「月500件制限に近づいています」）

### モジュール化対応

---

## 手順10：agents/scheduler.js を作成

- デフォルト：5本を1.5時間おき（--count 5 --interval 5400）
- オリジナル投稿5本＋引用RT5本＝合計10本/日が目安
- KILL_SWITCHを毎回チェック
- poster.jsのpostOne()をimportして使う

---

## 手順11：scripts/autopilot.js を作成

完全自動運転。1コマンドで全部。

1. KILL_SWITCHチェック
2. supervisor実行（CRITICALなら停止）
3. fetcher実行（メトリクス取得）
4. analyst実行（分析。10件未満ならスキップ）
5. researcher実行（最新ニュース＋バズ話題を収集）
6. writer実行（5本生成。research_poolの速報ネタを優先）
7. retweeter実行（バズツイートに独自コメント付き引用RT、5本）
8. scheduler起動（オリジナル5本を1.5時間おき）

---

## 手順12：scripts/dashboard.js を作成

表示内容：投稿状況、インプレッション（これを最も目立つように）、パフォーマンスTOP3、品質、パターン/テーマ分布、アラート、引用リツイート数。

---

## 手順13：KILL SWITCH

scripts/kill.sh と scripts/resume.sh を作成。
poster.jsとretweeter.jsの両方でKILL_SWITCHをチェック。引用リツイートもKILL時は停止。

---

## 手順14：テスト用スクリプト

agents/test-writer.js：1本だけ生成してコンソール表示（投稿しない）。

---

## 注意事項
- OAuth 1.0a署名はXで最もハマるポイント。特にpercent encodingとbase stringの構築順序に注意
- POSTでJSON bodyの場合、bodyパラメータはOAuth署名には含めない
- 免責文は投稿に入れない（プロフィールに記載済み）
- バズ最優先。analyst.jsの分析もインプレッション数を最重視
- researcher.jsのWeb検索が最重要。最新情報の鮮度が投稿の価値を決める
- 月500投稿制限に注意（dashboard.jsで表示）
- 全ファイル作成後、手順ごとに「完了しました」と報告
- 最後にtest-writer.jsを実行して投稿1本が正しく生成されることを確認
