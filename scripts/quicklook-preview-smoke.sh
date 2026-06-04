#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PREVIEW_ID="com.local.BurreteV10.Preview"
if [[ -n "${BURRETE_DEV_FLAVOR:-}" ]]; then
  command -v bun >/dev/null 2>&1 || { echo "error: BURRETE_DEV_FLAVOR requires bun to compute the dev namespace." >&2; exit 1; }
  eval "$(bun "$ROOT/scripts/dev-namespace.mjs" shell-env)"
  PREVIEW_ID="$BURRETE_PREVIEW_ID"
fi

LOG_PATH="${BURRETE_QUICKLOOK_SMOKE_LOG:-$HOME/Library/Containers/$PREVIEW_ID/Data/Library/Caches/Burrete/Burrete.log}"
RESULTS_PATH="${BURRETE_QUICKLOOK_SMOKE_RESULTS:-$ROOT/build/reports/quicklook-preview-smoke.tsv}"
TIMEOUT_SECONDS="${BURRETE_QUICKLOOK_SMOKE_TIMEOUT_SECONDS:-45}"
RESET_CACHE="${BURRETE_QUICKLOOK_SMOKE_RESET_CACHE:-1}"

if ! [[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SECONDS" -lt 1 ]]; then
  echo "error: BURRETE_QUICKLOOK_SMOKE_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 1
fi

if [[ "$#" -eq 0 ]]; then
  set -- "$ROOT/samples/mini.pdb" "$ROOT/samples/mini.cif" "$ROOT/samples/mini.xyz"
fi

mkdir -p "$(dirname "$RESULTS_PATH")"
printf 'status\ttype\tseconds\trequest_id\tfile\tnote\n' >"$RESULTS_PATH"

last_request_id_for_file() {
  local file="$1"
  [[ -f "$LOG_PATH" ]] || return 0
  grep -F "file.path=$file" "$LOG_PATH" 2>/dev/null | sed -E 's/.*\[([A-F0-9]+)\].*/\1/' | tail -n 1 || true
}

lines_for_request_id() {
  local request_id="$1"
  [[ -n "$request_id" && -f "$LOG_PATH" ]] || return 0
  grep -F "[$request_id]" "$LOG_PATH" 2>/dev/null || true
}

cleanup_file_preview() {
  local file="$1"
  local victims
  victims="$(ps ax -o pid=,command= | grep -F "$file" | grep -E 'qlmanage|force-preview' | grep -v grep | awk '{print $1}' || true)"
  if [[ -n "$victims" ]]; then
    printf '%s\n' "$victims" | while read -r victim; do
      kill "$victim" 2>/dev/null || true
    done
  fi
}

wait_for_preview_result() {
  local file="$1"
  local before_request_id="$2"
  local deadline=$((SECONDS + TIMEOUT_SECONDS))
  local request_id block

  while [[ "$SECONDS" -lt "$deadline" ]]; do
    request_id="$(last_request_id_for_file "$file")"
    if [[ -n "$request_id" && "$request_id" != "$before_request_id" ]]; then
      block="$(lines_for_request_id "$request_id")"
      if printf '%s\n' "$block" | grep -F 'JS message type=ready: ready' >/dev/null; then
        printf 'OK\t%s\tready\n' "$request_id"
        return 0
      fi
      if printf '%s\n' "$block" | grep -F 'renderNativeError' >/dev/null; then
        printf 'FAIL\t%s\t%s\n' "$request_id" "$(
          printf '%s\n' "$block" |
            grep -Ei 'renderNativeError|PreviewError|timeout|error|failed|exception|unsupported|could not' |
            tail -n 6 |
            tr '\n' ' ' |
            sed 's/[[:space:]]\+/ /g'
        )"
        return 0
      fi
    fi
    sleep 0.5
  done

  request_id="$(last_request_id_for_file "$file")"
  if [[ -n "$request_id" && "$request_id" != "$before_request_id" ]]; then
    block="$(lines_for_request_id "$request_id")"
    if printf '%s\n' "$block" | grep -F 'JS message type=ready: ready' >/dev/null; then
      printf 'OK\t%s\tready\n' "$request_id"
      return 0
    fi
  fi

  printf 'NO_REQUEST\t%s\tno new request-id in Burrete log\n' "${request_id:-}"
}

total=0
passed=0
failed=0

for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    echo "error: structure file not found: $file" >&2
    exit 1
  fi

  abs_file="$(cd -P "$(dirname "$file")" && pwd -P)/$(basename "$file")"
  type="$("$ROOT/scripts/preview-content-type.mjs" --reject-table "$abs_file")"
  if [[ -z "$type" ]]; then
    type="$(mdls -raw -name kMDItemContentType "$abs_file" 2>/dev/null || true)"
  fi
  if [[ -z "$type" || "$type" == "(null)" ]]; then
    echo "error: could not determine content type for $abs_file" >&2
    exit 1
  fi

  cleanup_file_preview "$abs_file"
  if [[ "$RESET_CACHE" == "1" ]]; then
    qlmanage -r cache >/dev/null 2>&1 || true
  fi

  before_request_id="$(last_request_id_for_file "$abs_file")"
  started="$SECONDS"
  stdout_path="$(mktemp "${TMPDIR:-/tmp}/burrete-quicklook-smoke.XXXXXX")"
  (
    cd "$ROOT"
    "$ROOT/scripts/force-preview.sh" "$abs_file"
  ) >"$stdout_path" 2>&1 &
  preview_pid=$!

  result="$(wait_for_preview_result "$abs_file" "$before_request_id")"
  cleanup_file_preview "$abs_file"
  if kill -0 "$preview_pid" 2>/dev/null; then
    kill "$preview_pid" 2>/dev/null || true
  fi
  wait "$preview_pid" 2>/dev/null || true
  rm -f "$stdout_path"

  seconds=$((SECONDS - started))
  status="$(printf '%s' "$result" | cut -f1)"
  request_id="$(printf '%s' "$result" | cut -f2)"
  note="$(printf '%s' "$result" | cut -f3-)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$status" "$type" "$seconds" "$request_id" "$abs_file" "$note" >>"$RESULTS_PATH"

  total=$((total + 1))
  if [[ "$status" == "OK" ]]; then
    passed=$((passed + 1))
    printf '[%02d] OK %s (%ss)\n' "$total" "$(basename "$abs_file")" "$seconds"
  else
    failed=$((failed + 1))
    printf '[%02d] %s %s (%ss) %s\n' "$total" "$status" "$(basename "$abs_file")" "$seconds" "$note"
  fi
done

printf 'SUMMARY ok=%s fail=%s total=%s result=%s\n' "$passed" "$failed" "$total" "$RESULTS_PATH"

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
