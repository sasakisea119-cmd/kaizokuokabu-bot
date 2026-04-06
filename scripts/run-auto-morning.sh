#!/bin/bash
DATE=$(date +%Y-%m-%d)
echo "=== 朝の全自動タスク: $DATE ==="

# Step 0: 目論見書自動チェック & ダウンロード
echo "[07:00] 目論見書チェック..."
python scripts/fetch-prospectus.py 2>&1 | tee -a employees/logs/prospectus-${DATE}.log &

# Step 1: Note対象銘柄の自動選定 & 執筆開始
echo "[07:00] Note対象銘柄選定 & 執筆開始..."
claude --print "note-writer社員として、Grok APIを使って本日のNote対象銘柄3つを自動選定してください。
選定結果を config/ipo-calendar.md に書き込み、その後3本のNote記事の執筆を開始してください。
上場予定銘柄がある場合は、employees/data/prospectus/の目論見書データを活用すること。" \
  --context employees/note-writer/CLAUDE.md \
  --context config/ipo-calendar.md \
  --context config/brand-voice.md &

# Step 2: 朝ポスト作成
echo "[07:00] 朝ポスト作成..."
claude --print "content-poster社員として、本日${DATE}の朝ポストを作成し、投稿キューに保存してください。1行目フックルールを厳守。" \
  --context employees/content-poster/CLAUDE.md \
  --context config/hook-patterns.md &

# Step 3: 交流アカ選定
echo "[07:00] 交流アカ選定..."
claude --print "account-selector社員として、本日の交流アカリストを10件作成してください。" \
  --context employees/account-selector/CLAUDE.md &

wait
echo "[09:00] 朝タスク第1波完了"

# Step 4: リプ案・いいねプラン・引用ポスト案
echo "[09:00] リプ案・いいね・引用ポスト案作成..."
claude --print "reply-worker社員として、本日の交流アカリストへのリプ案を作成してください。" \
  --context employees/reply-worker/CLAUDE.md \
  --context employees/logs/account-list-${DATE}.md &

claude --print "like-worker社員として、本日のいいねプランを作成してください。" \
  --context employees/like-worker/CLAUDE.md &

claude --print "quote-poster社員として、本日の引用ポスト案を3件作成してください。" \
  --context employees/quote-poster/CLAUDE.md &

wait

# Step 5: 昼ポスト作成
echo "[12:00] 昼ポスト作成..."
claude --print "content-poster社員として、本日${DATE}の昼ポストを作成し、投稿キューに保存してください。" \
  --context employees/content-poster/CLAUDE.md \
  --context config/hook-patterns.md &

wait
echo "=== 朝〜昼の全自動タスク完了 ==="
echo "=== 13:00の社長レビューで以下を確認してください ==="
echo "  - Note記事3本: employees/logs/note-articles/"
echo "  - リプ案: employees/logs/reply-drafts-${DATE}.md"
echo "  - いいねプラン: employees/logs/like-plan-${DATE}.md"
echo "  - 引用ポスト案: employees/logs/quote-drafts-${DATE}.md"
echo "  - 朝・昼ポスト: employees/logs/posts-${DATE}.md"
