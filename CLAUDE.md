# X 投資アカウント（kaizokuokabu）自動投稿システム

## プロジェクト概要
日本株・米国株の投資分析アカウント「kaizokuokabu」のX投稿を完全自動化するシステム。
6つのAIエージェントが連携して、リサーチ→分析→投稿生成→投稿実行→データ取得→監視を自動で回す。
**方針：バズらせてインプレッションを最大化することを最優先。**

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
│   └── .env
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
- 1日の投稿は合計10本目安：オリジナル投稿5本＋引用リツイート5本（半々が理想）
- 品質スコア7.0未満は自動棄却
- バズ（インプレッション最大化）を最優先で設計
- 特定銘柄の「買い推奨」「売り推奨」はしない（分析・解説に留める）
- 引用リツイートは投資クラスタでバズっている投稿に独自コメントを付けて引用RT

## 日常運用コマンド
- 完全自動運転:  node scripts/autopilot.js
- 状態確認:      node scripts/dashboard.js
- 緊急停止:      bash scripts/kill.sh
- 停止解除:      bash scripts/resume.sh
