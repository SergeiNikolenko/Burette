#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PREVIEW_ID="com.local.BurreteV10.Preview"
XYZ_CONTENT_TYPE="com.local.burrete10.xyz"
if [[ -n "${BURRETE_DEV_FLAVOR:-}" ]]; then
  command -v bun >/dev/null 2>&1 || { echo "error: BURRETE_DEV_FLAVOR requires bun to compute the dev namespace." >&2; exit 1; }
  eval "$(bun "$ROOT/scripts/dev-namespace.mjs" shell-env)"
  PREVIEW_ID="$BURRETE_PREVIEW_ID"
  XYZ_CONTENT_TYPE="$BURRETE_XYZ_CONTENT_TYPE"
fi
FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "usage: $0 /path/to/structure-file" >&2
  exit 1
fi
TYPE="$("$ROOT/scripts/preview-content-type.mjs" --reject-table "$FILE")"
if [[ -z "$TYPE" ]]; then
  TYPE="$(mdls -raw -name kMDItemContentType "$FILE" 2>/dev/null || true)"
fi
if [[ "$TYPE" == "$XYZ_CONTENT_TYPE" ]]; then
  # qlmanage aborts when forcing XYZ UTIs after the preview extension starts.
  # Normal Quick Look resolves XYZ to the registered Open Babel alias.
  set +e
  qlmanage -p "$FILE"
  STATUS=$?
  set -e
  if [[ "$STATUS" -eq 134 ]]; then
    sleep 2
    ABS_FILE="$(cd -P "$(dirname "$FILE")" && pwd -P)/$(basename "$FILE")"
    LOG_ROOT="$HOME/Library/Containers/$PREVIEW_ID/Data/Library"
    for LOG_FILE in \
      "$LOG_ROOT/Caches/Burrete/BurreteV10.log" \
      "$LOG_ROOT/Caches/Burrete/Burrete.log" \
      "$LOG_ROOT/Application Support/Burrete/BurreteV10.log" \
      "$LOG_ROOT/Application Support/Burrete/Burrete.log"
    do
      if [[ -f "$LOG_FILE" ]] && \
        tail -n 80 "$LOG_FILE" | grep -F "file.path=$ABS_FILE" >/dev/null && \
        tail -n 80 "$LOG_FILE" | grep -F "JS message type=ready: ready" >/dev/null; then
        echo "warning: qlmanage aborted after launching XYZ preview, but BurretePreview reported ready." >&2
        exit 0
      fi
    done
  fi
  exit "$STATUS"
fi
qlmanage -p -c "$TYPE" "$FILE"
