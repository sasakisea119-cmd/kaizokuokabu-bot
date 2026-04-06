#!/bin/bash
DATE=$(date +%Y-%m-%d)
echo "=== 夜の自動タスク: $DATE ==="

# 夜ポスト作成
claude --print "content-poster社員として、本日${DATE}の夜ポストを作成し、投稿キューに保存してください。" \
  --context employees/content-poster/CLAUDE.md \
  --context config/hook-patterns.md &

# 午後の引用ポスト追加案
claude --print "quote-poster社員として、午後〜夜の引用ポスト案を追加で1〜2件作成してください。" \
  --context employees/quote-poster/CLAUDE.md &

wait
echo "=== 夜タスク完了 ==="
