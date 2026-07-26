#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
MAX_FORCE_PREVIEW_COPY_BYTES=$((64 * 1024 * 1024))
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
  if ! ln "$FILE" "$PREVIEW_FILE" 2>/dev/null; then
    FILE_SIZE="$(stat -f '%z' "$FILE")"
    if [[ "$FILE_SIZE" -le "$MAX_FORCE_PREVIEW_COPY_BYTES" ]]; then
      cp -p "$FILE" "$PREVIEW_FILE"
    else
      # A cross-volume hard link is expected to fail. Copying a multi-GB source
      # into TMPDIR makes the smoke helper itself look hung, while qlmanage can
      # preview the original path with the same forced development UTI.
      PREVIEW_FILE="$FILE"
    fi
  fi
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
