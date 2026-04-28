#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
for path in . PreviewExtension/Web build; do
  [ -e "$path" ] || continue
  xattr -cr "$path" 2>/dev/null || true
  dot_clean -m "$path" 2>/dev/null || true
  find "$path" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
done
echo "Cleaned xattrs / AppleDouble / .DS_Store files."
