#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DEV_FLAVOR_SLUG=""
if [[ -n "${BURETTE_DEV_FLAVOR:-}" ]]; then
  command -v bun >/dev/null 2>&1 || { echo "error: BURETTE_DEV_FLAVOR requires bun to compute the dev namespace." >&2; exit 1; }
  eval "$(bun "$ROOT/scripts/dev-namespace.mjs" shell-env)"
  DEV_FLAVOR_SLUG="$BURETTE_DEV_FLAVOR_SLUG"
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
  DEV_PREVIEW_DIR="$(mktemp -d "${TMPDIR:-/tmp}/BurettePreview-${DEV_FLAVOR_SLUG}.XXXXXX")"
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
  echo "Use browser-dev or the desktop app to verify Burette grid rendering for: $FILE" >&2
  exit 2
fi
qlmanage -p -c "$TYPE" "$PREVIEW_FILE"
