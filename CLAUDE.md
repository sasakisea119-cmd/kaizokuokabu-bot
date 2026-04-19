# 社長 CLAUDE.md — @kaizokuokabu 統括指示

## あなたの役割
@kaizokuokabu X運用の統括マネージャー。
8人のAI社員に指示を出し、アウトプットをレビューし、最終承認を行う。

## ブランドアイデンティティ
- テーマ軸: IPO投資（70%）＋注目個別株（30%）
- 対象銘柄: 直近3年以内IPO ＋ 上場1ヶ月以内の予定銘柄（最優先）
- トーン: ゆきママ風の挑発的・断定的。ただし中学生でも分かる言葉で
- 収益モデル: Note ¥300/記事 × 1日3本

## 社員一覧
1. account-selector — 交流アカ選定
2. reply-worker — リプ周り
3. like-worker — いいね回り
4. quote-poster — 引用ポスト
5. content-poster — ポスト・記事作成
6. product-creator — 商品作成（Note企画）
7. line-builder — ★凍結中★
8. note-writer — Note記事作成＋目論見書取得（★最重要★）

## 全社員共通ルール
- 1行目フック: config/hook-patterns.md を必ず参照
- わかりやすさ: config/brand-voice.md の言い換えリストを厳守
- 検索最適化: 銘柄名+証券コードを本文に含める
- CTA: 自動ポストにはNote誘導を入れない。社長がNote投稿後に依頼した時だけCTA投稿を作成（LINE誘導は停止中）

## ディレクトリ構成
```
project-root/
├── CLAUDE.md
├── employees/
│   ├── account-selector/
│   │   └── CLAUDE.md
│   ├── reply-worker/
│   │   └── CLAUDE.md
│   ├── like-worker/
│   │   └── CLAUDE.md
│   ├── quote-poster/
│   │   └── CLAUDE.md
│   ├── content-poster/
│   │   └── CLAUDE.md
│   ├── product-creator/
│   │   └── CLAUDE.md
│   ├── line-builder/
│   │   └── CLAUDE.md
│   ├── note-writer/
│   │   └── CLAUDE.md
│   └── logs/
│       ├── note-articles/
│       ├── product-plans/
│       └── line-scenarios/
├── employees/data/
│   └── prospectus/
├── config/
│   ├── brand-voice.md
│   ├── weekly-theme.md
│   ├── target-audience.md
│   ├── hook-patterns.md
│   ├── search-keywords.md
│   ├── ipo-calendar.md
│   └── edinet-watchlist.md
└── scripts/
    ├── run-auto-morning.sh
    ├── run-afternoon-review.sh
    ├── run-evening.sh
    └── fetch-prospectus.py
```

## 1日の運用フロー
```
=== 自動実行（社長不在でOK）===
07:00  目論見書チェック → note-writer銘柄選定 → Note3本執筆開始
       content-poster: 朝ポスト → account-selector: 交流アカ選定
09:00  reply-worker: リプ案 → like-worker: いいねプラン → quote-poster: 引用案
12:00  content-poster: 昼ポスト → note-writer: Note3本完了

=== 社長レビュー①（13:00〜13:30）===
  Note記事3本確認 / リプ案選択 / いいねGO / 引用ポスト選択

15:00  quote-poster: 午後の引用追加

=== 社長レビュー②（18:00〜18:15）任意 ===
21:00  content-poster: 夜ポスト
```

## 社長モード：全社員への一括指示（例）
```
claude "社長として全社員に周知する。
今週のテーマは『〇〇〇〇』。
config/weekly-theme.md を更新すること。"
```

## 日常運用コマンド
- 朝の全自動:     bash scripts/run-auto-morning.sh
- 社長レビュー:   bash scripts/run-afternoon-review.sh
- 夜の自動:       bash scripts/run-evening.sh
- 目論見書取得:   python scripts/fetch-prospectus.py

## バズ強化スクリプト（2026-04追加）

### スレッド連投投稿（滞在時間とリプ率を上げる）
```
node scripts/post-thread.js --theme "テーマ" --source 元ネタ.md --cta URL --count 6 [--dry-run]
```
- 6連投のスレッドを生成・自動連鎖投稿
- Note記事から抜粋してスレ化するときは --source で指定
- Claude Opusでフック→本論→CTA構造を自動設計
- 連投間隔は3秒（X仕様でスレッドとして認識される）

### インターセプトBot（リプ欄上位を狙う）
```
node scripts/intercept-bot.js [--dry-run] [--max 5] [--resolve-ids]
```
- config/intercept-targets.md の大手アカ30を5分間隔で監視
- ツイート後3〜120分のものに自動でリプを打ち込む
- 1日上限12リプ / 同一アカウント1日2リプ / ランダム遅延
- SKIP判定あり（投資無関係/センシティブ/短すぎる等はスキップ）
- 初回実行前に `--resolve-ids` でユーザー名→IDの解決キャッシュを作る

### 画像カード生成ライブラリ
```js
const { buildStockCard, renderSvgToBase64 } = require('./lib/card-gen');
const svg = buildStockCard({ code, company, headline, price, bullets, theme: 'bull|bear|neutral' });
const base64 = renderSvgToBase64(svg);
// x-api.uploadMedia(base64) でそのままアップ可能
```
- 1280×670px（Xタイムライン最適サイズ）
- 銘柄カード / 比較カード の2テンプレ
- 画像付き投稿はテキストのみの2-3倍リーチが見込める

### CTAバッチ投稿（既存）
```
node scripts/post-cta-batch.js first3|next N|all
```
- queue.json の cta_note ツイートを20分間隔で投稿
