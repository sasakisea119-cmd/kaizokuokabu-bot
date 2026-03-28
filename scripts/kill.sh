#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data"

echo "MANUAL_KILL $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DATA_DIR/KILL_SWITCH"
echo "[KILL] 緊急停止しました。投稿・引用RTは停止されます。"
echo "[KILL] 解除するには: bash scripts/resume.sh"
