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
if (format?.contentType) process.stdout.write(format.contentType);
NODE
)"
if [[ -z "$TYPE" ]]; then
  TYPE="$(mdls -raw -name kMDItemContentType "$FILE" 2>/dev/null || true)"
fi
qlmanage -p -c "$TYPE" "$FILE"
