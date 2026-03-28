#!/bin/bash
# 手動実行用：各エージェントを2分間隔で順番に実行
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

echo "=== kaizokuokabu 手動実行 ==="
echo "$(date)"

echo "--- Researcher ---"
node agents/researcher.js
echo "2分待機..."
sleep 120

echo "--- Writer ---"
node agents/writer.js
echo "2分待機..."
sleep 120

echo "--- Image Poster ---"
node agents/image-poster.js
echo "2分待機..."
sleep 120

echo "--- Retweeter ---"
node agents/retweeter.js

echo "--- Scheduler ---"
node agents/scheduler.js --count 5 --interval 5400

echo "=== 完了 ==="
