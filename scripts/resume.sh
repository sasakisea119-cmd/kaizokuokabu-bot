#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$SCRIPT_DIR/../data"

if [ -f "$DATA_DIR/KILL_SWITCH" ]; then
  rm "$DATA_DIR/KILL_SWITCH"
  echo "[RESUME] KILL_SWITCHを解除しました。投稿を再開できます。"
else
  echo "[RESUME] KILL_SWITCHは設定されていません。"
fi
