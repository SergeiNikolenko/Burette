#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PREVIEW_ID="com.local.BurreteV10.Preview"
XYZ_CONTENT_TYPE="com.local.burrete10.xyz"
DEV_FLAVOR_SLUG=""
if [[ -n "${BURRETE_DEV_FLAVOR:-}" ]]; then
  command -v bun >/dev/null 2>&1 || { echo "error: BURRETE_DEV_FLAVOR requires bun to compute the dev namespace." >&2; exit 1; }
  eval "$(bun "$ROOT/scripts/dev-namespace.mjs" shell-env)"
  PREVIEW_ID="$BURRETE_PREVIEW_ID"
  XYZ_CONTENT_TYPE="$BURRETE_XYZ_CONTENT_TYPE"
  DEV_FLAVOR_SLUG="$BURRETE_DEV_FLAVOR_SLUG"
fi
FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "usage: $0 /path/to/structure-file" >&2
  exit 1
fi
PREVIEW_FILE="$FILE"
DEV_PREVIEW_DIR=""
cleanup_dev_preview_dir() {
  [[ -z "$DEV_PREVIEW_DIR" ]] || rm -rf "$DEV_PREVIEW_DIR" 2>/dev/null || true
}
trap cleanup_dev_preview_dir EXIT
if [[ -n "$DEV_FLAVOR_SLUG" ]]; then
  DEV_PREVIEW_DIR="$(mktemp -d "${TMPDIR:-/tmp}/BurretePreview-${DEV_FLAVOR_SLUG}.XXXXXX")"
  PREVIEW_FILE="$DEV_PREVIEW_DIR/${DEV_FLAVOR_SLUG} $(basename "$FILE")"
  ln "$FILE" "$PREVIEW_FILE" 2>/dev/null || cp -p "$FILE" "$PREVIEW_FILE"
fi
set +e
TYPE="$("$ROOT/scripts/preview-content-type.mjs" --reject-table "$FILE" 2>/dev/null)"
TYPE_STATUS=$?
set -e
if [[ "$TYPE_STATUS" -eq 2 || -z "$TYPE" ]]; then
  TYPE="$(mdls -raw -name kMDItemContentType "$FILE" 2>/dev/null || true)"
elif [[ "$TYPE_STATUS" -ne 0 ]]; then
  echo "error: could not determine registry content type for $FILE" >&2
  exit "$TYPE_STATUS"
fi
if [[ "$TYPE" == "public.comma-separated-values-text" ||
      "$TYPE" == "public.tab-separated-values-text" ]]; then
  echo "error: native Finder Quick Look for public CSV/TSV is owned by the system table generator." >&2
  echo "Use browser-dev or the desktop app to verify Burrete grid rendering for: $FILE" >&2
  exit 2
fi
if [[ "$TYPE" == "$XYZ_CONTENT_TYPE" ]]; then
  # qlmanage aborts when forcing XYZ UTIs after the preview extension starts.
  # Normal Quick Look resolves XYZ to the registered preview.
  set +e
  qlmanage -p "$PREVIEW_FILE"
  STATUS=$?
  set -e
  if [[ "$STATUS" -eq 134 ]]; then
    sleep 2
    ABS_FILE="$(cd -P "$(dirname "$PREVIEW_FILE")" && pwd -P)/$(basename "$PREVIEW_FILE")"
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
qlmanage -p -c "$TYPE" "$PREVIEW_FILE"
