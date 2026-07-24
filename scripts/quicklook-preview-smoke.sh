#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PREVIEW_ID="com.local.BuretteV10.Preview"
DEV_FLAVOR_SLUG=""
APP_BUNDLE_NAME="Burette.app"
if [[ -n "${BURETTE_DEV_FLAVOR:-}" ]]; then
  command -v bun >/dev/null 2>&1 || { echo "error: BURETTE_DEV_FLAVOR requires bun to compute the dev namespace." >&2; exit 1; }
  eval "$(bun "$ROOT/scripts/dev-namespace.mjs" shell-env)"
  PREVIEW_ID="$BURETTE_PREVIEW_ID"
  DEV_FLAVOR_SLUG="$BURETTE_DEV_FLAVOR_SLUG"
  APP_BUNDLE_NAME="$BURETTE_APP_BUNDLE_NAME"
fi

LOG_PATH="${BURETTE_QUICKLOOK_SMOKE_LOG:-$HOME/Library/Containers/$PREVIEW_ID/Data/Library/Caches/Burette/Burette.log}"
TRACE_PATH="${BURETTE_QUICKLOOK_SMOKE_TRACE:-$HOME/Library/Containers/$PREVIEW_ID/Data/Library/Caches/Burette/preview-trace.jsonl}"
RESULTS_PATH="${BURETTE_QUICKLOOK_SMOKE_RESULTS:-$ROOT/build/reports/quicklook-preview-smoke.tsv}"
TIMEOUT_SECONDS="${BURETTE_QUICKLOOK_SMOKE_TIMEOUT_SECONDS:-45}"
RESET_CACHE="${BURETTE_QUICKLOOK_SMOKE_RESET_CACHE:-1}"
INSTALLED_PREVIEW_EXECUTABLE="$HOME/Applications/$APP_BUNDLE_NAME/Contents/PlugIns/BurettePreview.appex/Contents/MacOS/BurettePreview"

if ! [[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SECONDS" -lt 1 ]]; then
  echo "error: BURETTE_QUICKLOOK_SMOKE_TIMEOUT_SECONDS must be a positive integer" >&2
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

trace_request_id_for_block() {
  local block="$1"
  printf '%s\n' "$block" |
    grep -F 'trace.requestID=' |
    sed -E 's/.*trace\.requestID=([^ ]+) state=.*/\1/' |
    tail -n 1 || true
}

runtime_directory_for_block() {
  local block="$1"
  printf '%s\n' "$block" |
    grep -F '[build] runtimeDirectory=' |
    sed -E 's/.*\[build\] runtimeDirectory=//' |
    tail -n 1 || true
}

extension_launch_failure_note() {
  local lookback_seconds="$1"
  local diagnostics

  [[ -x /usr/bin/log ]] || return 0
  diagnostics="$(
    {
      /usr/bin/log show --last "${lookback_seconds}s" --style compact \
        --predicate "eventMessage CONTAINS \"$PREVIEW_ID\" OR eventMessage CONTAINS \"BurettePreview\"" 2>/dev/null |
        grep -E 'AppleMobileFileIntegrityError|not valid:|Hub connection error|must have pid|Unable to acquire process assertion|PlugInKit error|DID FAIL LOADING|connection to service named' |
        tail -n 6 |
        tr '\n' ' ' |
        sed 's/[[:space:]]\+/ /g; s/[[:space:]]$//'
    } || true
  )"
  [[ -n "$diagnostics" ]] || return 0
  printf 'Quick Look extension launch failure: %s\n' "$diagnostics"
}

adhoc_extension_note() {
  local details

  [[ -x "$INSTALLED_PREVIEW_EXECUTABLE" && -x /usr/bin/codesign ]] || return 0
  details="$(/usr/bin/codesign -dv "$INSTALLED_PREVIEW_EXECUTABLE" 2>&1 || true)"
  if printf '%s\n' "$details" | grep -F 'Signature=adhoc' >/dev/null; then
    printf 'Quick Look extension did not launch; installed preview extension is ad-hoc signed: %s\n' "$INSTALLED_PREVIEW_EXECUTABLE"
  fi
}

validate_stability_artifacts() {
  local trace_request_id="$1"
  local runtime_directory="$2"

  if [[ -z "$trace_request_id" ]]; then
    printf 'missing trace.requestID log entry\n'
    return 1
  fi
  if [[ -z "$runtime_directory" ]]; then
    printf 'missing runtimeDirectory log entry\n'
    return 1
  fi

  python3 - "$TRACE_PATH" "$trace_request_id" "$runtime_directory" <<'PY'
import json
import pathlib
import sys

trace_path = pathlib.Path(sys.argv[1])
request_id = sys.argv[2]
runtime_directory = pathlib.Path(sys.argv[3])

if not trace_path.exists():
    print(f"missing preview trace: {trace_path}")
    sys.exit(1)

completed = None
for raw in trace_path.read_text(encoding="utf-8").splitlines():
    if not raw.strip():
        continue
    try:
        event = json.loads(raw)
    except json.JSONDecodeError:
        continue
    if (
        event.get("state") == "completed"
        and event.get("subsystem") == "quicklook"
        and (event.get("requestID") == request_id or event.get("documentId") == request_id)
    ):
        completed = event

if completed is None:
    print(f"missing completed preview trace event for request {request_id}")
    sys.exit(1)

trace_runtime = completed.get("runtimePath")
if trace_runtime and pathlib.Path(trace_runtime) != runtime_directory:
    print(f"trace runtimePath mismatch: {trace_runtime} != {runtime_directory}")
    sys.exit(1)

manifest_path = runtime_directory / "manifest.json"
if not manifest_path.exists():
    print(f"missing runtime manifest: {manifest_path}")
    sys.exit(1)

try:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
except json.JSONDecodeError as error:
    print(f"invalid runtime manifest JSON: {error}")
    sys.exit(1)

if manifest.get("schemaVersion") != 1:
    print(f"unexpected manifest schemaVersion: {manifest.get('schemaVersion')}")
    sys.exit(1)
if manifest.get("complete") is not True:
    print("runtime manifest is not complete")
    sys.exit(1)
if manifest.get("documentId") in (None, "", "unknown"):
    print("runtime manifest documentId is missing")
    sys.exit(1)
if not manifest.get("renderer"):
    print("runtime manifest renderer is missing")
    sys.exit(1)

print("trace+manifest")
PY
}

validate_semantic_preview() {
  local preview_file="$1"
  local note
  local status=0
  local deadline=$((SECONDS + 8))

  while [[ "$SECONDS" -le "$deadline" ]]; do
    status=0
    note="$(bun "$ROOT/scripts/quicklook-semantic-check.mjs" "$LOG_PATH" "$preview_file" 2>&1)" || status=$?
    note="$(printf '%s' "$note" | tr '\t' ' ' | tr '\n' ' ' | sed 's/[[:space:]]\{1,\}/ /g; s/[[:space:]]$//')"
    if [[ "$status" -eq 0 ]]; then
      printf 'semantic: %s\n' "$note"
      return 0
    fi
    if [[ "$status" -eq 2 ]]; then
      printf 'semantic skipped: %s\n' "$note"
      return 0
    fi
    sleep 0.25
  done

  printf 'semantic preview failed: %s\n' "$note"
  return 1
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

cleanup_quicklook_ui() {
  killall qlmanage >/dev/null 2>&1 || true
  killall QuickLookUIService >/dev/null 2>&1 || true
}

is_system_table_type() {
  local type="$1"
  [[ "$type" == "public.comma-separated-values-text" ||
     "$type" == "public.tab-separated-values-text" ]]
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

  diagnostic_note="$(extension_launch_failure_note "$((TIMEOUT_SECONDS + 15))")"
  if [[ -n "$diagnostic_note" ]]; then
    printf 'FAIL\t%s\t%s\n' "${request_id:-}" "$diagnostic_note"
  elif diagnostic_note="$(adhoc_extension_note)" && [[ -n "$diagnostic_note" ]]; then
    printf 'FAIL\t%s\t%s\n' "${request_id:-}" "$diagnostic_note"
  else
    printf 'NO_REQUEST\t%s\tno new request-id in Burette log\n' "${request_id:-}"
  fi
}

run_preview() {
  local type="$1"
  local preview_file="$2"

  qlmanage -p -c "$type" "$preview_file"
}

total=0
passed=0
failed=0
skipped=0

for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    echo "error: structure file not found: $file" >&2
    exit 1
  fi

  abs_file="$(cd -P "$(dirname "$file")" && pwd -P)/$(basename "$file")"
  set +e
  type="$("$ROOT/scripts/preview-content-type.mjs" --reject-table "$abs_file" 2>/dev/null)"
  content_type_status=$?
  set -e
  if [[ "$content_type_status" -eq 2 || -z "$type" ]]; then
    type="$(mdls -raw -name kMDItemContentType "$abs_file" 2>/dev/null || true)"
  elif [[ "$content_type_status" -ne 0 ]]; then
    echo "error: could not determine registry content type for $abs_file" >&2
    exit "$content_type_status"
  fi
  if [[ -z "$type" || "$type" == "(null)" ]]; then
    echo "error: could not determine content type for $abs_file" >&2
    exit 1
  fi

  total=$((total + 1))
  if is_system_table_type "$type"; then
    note="SKIP: system Quick Look owns public table UTI; verify CSV/TSV grid in browser-dev or desktop instead"
    printf 'SKIP\t%s\t0\t\t%s\t%s\n' "$type" "$abs_file" "$note" >>"$RESULTS_PATH"
    skipped=$((skipped + 1))
    printf '[%02d] SKIP %s %s\n' "$total" "$(basename "$abs_file")" "$note"
    continue
  fi

  preview_file="$abs_file"
  dev_preview_dir=""
  if [[ -n "$DEV_FLAVOR_SLUG" ]]; then
    tmp_base="${TMPDIR:-/tmp}"
    tmp_base="${tmp_base%/}"
    dev_preview_dir="$(mktemp -d "$tmp_base/BurettePreview-${DEV_FLAVOR_SLUG}.XXXXXX")"
    preview_file="$dev_preview_dir/${DEV_FLAVOR_SLUG} $(basename "$abs_file")"
    ln "$abs_file" "$preview_file" 2>/dev/null || cp -p "$abs_file" "$preview_file"
  fi
  cleanup_preview_dir() {
    [[ -z "$dev_preview_dir" ]] || rm -rf "$dev_preview_dir" 2>/dev/null || true
  }

  cleanup_quicklook_ui
  cleanup_file_preview "$preview_file"
  if [[ "$RESET_CACHE" == "1" ]]; then
    qlmanage -r cache >/dev/null 2>&1 || true
  fi

  before_request_id="$(last_request_id_for_file "$preview_file")"
  started="$SECONDS"
  stdout_path="$(mktemp "${TMPDIR:-/tmp}/burette-quicklook-smoke.XXXXXX")"
  (
    cd "$ROOT"
    run_preview "$type" "$preview_file"
  ) >"$stdout_path" 2>&1 &
  preview_pid=$!

  result="$(wait_for_preview_result "$preview_file" "$before_request_id")"

  seconds=$((SECONDS - started))
  status="$(printf '%s' "$result" | cut -f1)"
  request_id="$(printf '%s' "$result" | cut -f2)"
  note="$(printf '%s' "$result" | cut -f3-)"
  if [[ "$status" == "OK" ]]; then
    block="$(lines_for_request_id "$request_id")"
    trace_request_id="$(trace_request_id_for_block "$block")"
    runtime_directory="$(runtime_directory_for_block "$block")"
    if stability_note="$(validate_stability_artifacts "$trace_request_id" "$runtime_directory")"; then
      note="$note; $stability_note"
    else
      status="FAIL"
      note="$stability_note"
    fi
    if [[ "$status" == "OK" ]]; then
      if semantic_note="$(validate_semantic_preview "$preview_file")"; then
        note="$note; $semantic_note"
      else
        status="FAIL"
        note="$semantic_note"
      fi
    fi
  fi

  cleanup_file_preview "$preview_file"
  if kill -0 "$preview_pid" 2>/dev/null; then
    kill "$preview_pid" 2>/dev/null || true
  fi
  wait "$preview_pid" 2>/dev/null || true
  cleanup_preview_dir
  rm -f "$stdout_path"

  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$status" "$type" "$seconds" "$request_id" "$abs_file" "$note" >>"$RESULTS_PATH"

  if [[ "$status" == "OK" ]]; then
    passed=$((passed + 1))
    printf '[%02d] OK %s (%ss)\n' "$total" "$(basename "$abs_file")" "$seconds"
  else
    failed=$((failed + 1))
    printf '[%02d] %s %s (%ss) %s\n' "$total" "$status" "$(basename "$abs_file")" "$seconds" "$note"
  fi
done

cleanup_quicklook_ui

printf 'SUMMARY ok=%s fail=%s skip=%s total=%s result=%s\n' "$passed" "$failed" "$skipped" "$total" "$RESULTS_PATH"

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
