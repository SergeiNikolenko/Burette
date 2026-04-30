#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PORT="${PORT:-8765}"
SAMPLE="${1:-samples/mini.pdb}"
OUT_DIR="$ROOT/build/web-preview"

"$ROOT/scripts/test-web-preview.sh" --no-open --out-dir "$OUT_DIR" "$SAMPLE" >/dev/null

echo "Serving web preview:"
echo "  http://127.0.0.1:$PORT/index.html"
echo "Press Ctrl-C to stop."
cd "$OUT_DIR/Web"
python3 -m http.server "$PORT" --bind 127.0.0.1
