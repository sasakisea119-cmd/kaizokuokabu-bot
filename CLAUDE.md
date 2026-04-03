# X 投資アカウント（kaizokuokabu）自動投稿システム

## プロジェクト概要
日本株・米国株の投資分析アカウント「kaizokuokabu」のX投稿を完全自動化するシステム。
AIエージェント群（6コアエージェント + 7社員エージェント）が連携して、
リサーチ→分析→投稿生成→投稿実行→交流→データ取得→監視→収益化を自動で回す。
**方針：バズらせてインプレッションを最大化することを最優先。**

## 社長（Claude Code = 統括AI）
- 全社員の実行順序・タイミングを管理
- 異常検知時の緊急停止判断
- 週次でKPI確認・戦略調整指示

## ディレクトリ構成
```
x-kaizokuokabu-bot/
├── CLAUDE.md
├── knowledge/
│   ├── persona.json
│   ├── patterns.json
│   ├── hooks.json
│   └── buzz_references.json
├── lib/
│   └── x-api.js          ← X API共通ユーティリティ（OAuth 1.0a署名）
├── agents/
│   ├── writer.js
│   ├── poster.js
│   ├── fetcher.js
│   ├── analyst.js
│   ├── researcher.js
│   ├── supervisor.js
│   └── scheduler.js
├── data/
│   ├── queue.json
│   ├── post_history.json
│   ├── analyst_feedback.json
│   ├── research_pool.json
│   └── logs/
├── scripts/
│   ├── autopilot.js
│   ├── dashboard.js
│   ├── kill.sh
│   └── resume.sh
├── config/
│   ├── .env
│   ├── brand-voice.md       ← ブランドボイスガイドライン
│   ├── weekly-theme.md      ← 週間テーマカレンダー
│   └── target-audience.md   ← ターゲットオーディエンス定義
├── employees/
│   ├── account-selector/    ← 社員1: 交流アカウント選定
│   ├── reply-worker/        ← 社員2: リプライ自動生成
│   ├── like-worker/         ← 社員3: 戦略的いいね
│   ├── quote-poster/        ← 社員4: 引用RT（retweeter拡張）
│   ├── content-poster/      ← 社員5: オリジナル投稿（writer拡張）
│   ├── product-creator/     ← 社員6: 収益化コンテンツ企画
│   ├── line-builder/        ← 社員7: LINE導線設計
│   └── logs/                ← 社員ログ・月次企画
└── package.json
```

## 技術スタック
- Node.js 18+
- Anthropic API（Claude Sonnet）で投稿テキスト生成
- X API v2（OAuth 1.0a）で投稿・引用リツイート実行
- dotenvで環境変数管理

## 6エージェント構成
1. **リサーチャー**：Web検索で最新のバズツイート＋国内外の投資ニュースを収集
2. **アナリスト**：投稿パフォーマンス分析→ライターにフィードバック
3. **ライター**：ナレッジ＋リサーチ＋フィードバックを読んで投稿を生成
4. **ポスター**：X API v2で投稿＋リツイート実行
5. **フェッチャー**：X APIからインプレッション・いいね等を取得
6. **スーパーバイザー**：全体監視・異常検知・緊急停止

## X API仕様メモ
- 投稿: POST https://api.x.com/2/tweets（OAuth 1.0a署名）
- 引用リツイート: POST https://api.x.com/2/tweets（OAuth 1.0a署名）body: { "text": "コメント", "quote_tweet_id": "xxx" }
- メトリクス: GET https://api.x.com/2/tweets/{id}?tweet.fields=public_metrics
- 自分のuser_id取得: GET https://api.x.com/2/users/me
- 無料プランは月500投稿（リツイート含む）
- 1日の投稿上限は50ツイート

## 重要ルール
- 免責文はプロフィールに記載済みなので投稿本文には不要
- 投稿間隔は最低30分空ける
- 1日の投稿は合計12本目安：オリジナル8本＋引用RT3本＋リプライ3本（月500枠管理）
- 品質スコア7.0未満は自動棄却
- バズ（インプレッション最大化）を最優先で設計
- 特定銘柄の「買い推奨」「売り推奨」はしない（分析・解説に留める）
- 引用リツイートは投資クラスタでバズっている投稿に独自コメントを付けて引用RT

## 7社員エージェント（Claude Code Company）
1. **社員1 account-selector**: Grok x_searchで交流すべき投資アカウントを自動選定（毎朝）
2. **社員2 reply-worker**: 選定アカウントの投稿にリプライ（1日6〜9件）
3. **社員3 like-worker**: 戦略的いいね（1日15〜30件）
4. **社員4 quote-poster**: バズ投稿の引用RT（1日5件、retweeter.js拡張）
5. **社員5 content-poster**: オリジナル投稿生成（1日10件、writer.js拡張）
6. **社員6 product-creator**: Note記事・アフィリエイト企画（月1回）
7. **社員7 line-builder**: LINE配信シナリオ生成（月1回）

各社員の詳細仕様は `employees/*/CLAUDE.md` を参照。

## 日常運用コマンド
- 完全自動運転:  node scripts/autopilot.js
- 状態確認:      node scripts/dashboard.js
- 緊急停止:      bash scripts/kill.sh
- 停止解除:      bash scripts/resume.sh
