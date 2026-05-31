#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "usage: $0 /path/to/structure-file" >&2
  exit 1
fi
TYPE="$(
  node --input-type=module - "$ROOT/config/preview-formats.json" "$FILE" <<'NODE'
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const registry = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const fileName = basename(process.argv[3]).toLowerCase();
const extension = fileName.endsWith('.mae.gz') ? 'mae.gz' : extname(fileName).slice(1);
const format = registry.formats.find((candidate) => candidate.extensions.includes(extension));
if (format?.id === 'csv' || format?.id === 'tsv') {
  console.error('CSV/TSV table previews must be tested with normal Quick Look selection; qlmanage aborts when forcing custom table UTIs.');
  process.exit(2);
}
if (format?.contentType) process.stdout.write(format.contentType);
NODE
)"
if [[ -z "$TYPE" ]]; then
  TYPE="$(mdls -raw -name kMDItemContentType "$FILE" 2>/dev/null || true)"
fi
if [[ "$TYPE" == "com.local.burrete10.xyz" ]]; then
  # qlmanage aborts when forcing XYZ UTIs after the preview extension starts.
  # Normal Quick Look resolves XYZ to the registered Open Babel alias.
  set +e
  qlmanage -p "$FILE"
  STATUS=$?
  set -e
  if [[ "$STATUS" -eq 134 ]]; then
    sleep 2
    ABS_FILE="$(cd -P "$(dirname "$FILE")" && pwd -P)/$(basename "$FILE")"
    LOG_ROOT="$HOME/Library/Containers/com.local.BurreteV10.Preview/Data/Library"
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
