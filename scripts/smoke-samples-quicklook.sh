#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

usage() {
  cat >&2 <<'EOF'
usage: BURRETE_DEV_FLAVOR=<flavor> scripts/smoke-samples-quicklook.sh [samples-dir]

Runs every file under samples-dir through the installed Burrete Quick Look
preview extension and writes TSV/Markdown reports under build/reports.

Environment:
  BURRETE_DEV_FLAVOR                         Required. Keeps the smoke isolated.
  BURRETE_SAMPLES_QUICKLOOK_TIMEOUT_SECONDS Default per-file timeout.
  BURRETE_SAMPLES_QUICKLOOK_LONG_TIMEOUT_SECONDS
                                             Timeout for large/heavy samples.
  BURRETE_SAMPLES_QUICKLOOK_RESULTS         Optional TSV output path.
  BURRETE_SAMPLES_QUICKLOOK_RESET_CACHE     1 to reset Quick Look cache at start.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${BURRETE_DEV_FLAVOR:-}" ]]; then
  echo "error: BURRETE_DEV_FLAVOR is required for all-samples Quick Look smoke." >&2
  echo "Use a dev flavor such as: BURRETE_DEV_FLAVOR=8d21-demo $0" >&2
  exit 1
fi

command -v bun >/dev/null 2>&1 || {
  echo "error: BURRETE_DEV_FLAVOR requires bun to compute the dev namespace." >&2
  exit 1
}

eval "$(bun "$ROOT/scripts/dev-namespace.mjs" shell-env)"

SAMPLES_DIR="${1:-$ROOT/samples}"
if [[ ! -d "$SAMPLES_DIR" ]]; then
  echo "error: samples directory not found: $SAMPLES_DIR" >&2
  exit 1
fi
SAMPLES_DIR="$(cd -P "$SAMPLES_DIR" && pwd -P)"

APP_PATH="$HOME/Applications/$BURRETE_APP_BUNDLE_NAME"
APPEX_PATH="$APP_PATH/Contents/PlugIns/BurretePreview.appex"
if [[ ! -d "$APPEX_PATH" ]]; then
  echo "error: installed dev Quick Look extension not found: $APPEX_PATH" >&2
  echo "Build and install first:" >&2
  echo "  BURRETE_DEV_FLAVOR=$BURRETE_DEV_FLAVOR ./scripts/build.sh" >&2
  echo "  BURRETE_DEV_FLAVOR=$BURRETE_DEV_FLAVOR ./scripts/install.sh" >&2
  exit 1
fi

DEFAULT_TIMEOUT_SECONDS="${BURRETE_SAMPLES_QUICKLOOK_TIMEOUT_SECONDS:-25}"
LONG_TIMEOUT_SECONDS="${BURRETE_SAMPLES_QUICKLOOK_LONG_TIMEOUT_SECONDS:-75}"
RESET_CACHE="${BURRETE_SAMPLES_QUICKLOOK_RESET_CACHE:-1}"

if ! [[ "$DEFAULT_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$DEFAULT_TIMEOUT_SECONDS" -lt 1 ]]; then
  echo "error: BURRETE_SAMPLES_QUICKLOOK_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 1
fi
if ! [[ "$LONG_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$LONG_TIMEOUT_SECONDS" -lt 1 ]]; then
  echo "error: BURRETE_SAMPLES_QUICKLOOK_LONG_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 1
fi

REPORT_DIR="$ROOT/build/reports"
mkdir -p "$REPORT_DIR"
STAMP="$(date +%Y%m%d%H%M%S)"
RESULTS_PATH="${BURRETE_SAMPLES_QUICKLOOK_RESULTS:-$REPORT_DIR/quicklook-samples-smoke-${BURRETE_DEV_FLAVOR_SLUG}-${STAMP}.tsv}"
SUMMARY_PATH="${RESULTS_PATH%.tsv}.md"

LOG_ROOT="$HOME/Library/Containers/$BURRETE_PREVIEW_ID/Data/Library"
LOG_FILES=(
  "$LOG_ROOT/Caches/Burrete/BurreteV10.log"
  "$LOG_ROOT/Caches/Burrete/Burrete.log"
  "$LOG_ROOT/Application Support/Burrete/BurreteV10.log"
  "$LOG_ROOT/Application Support/Burrete/Burrete.log"
)

list_sample_files() {
  if command -v fd >/dev/null 2>&1; then
    fd -t f . "$SAMPLES_DIR" | sort
  else
    find "$SAMPLES_DIR" -type f | sort
  fi | while IFS= read -r file; do
    [[ "$(basename "$file")" == ".DS_Store" ]] && continue
    if [[ "$SAMPLES_DIR" == "$ROOT/samples" && "$file" == "$ROOT/samples/preview-matrix.json" ]]; then
      continue
    fi
    printf '%s\n' "$file"
  done
}

absolute_file() {
  local file="$1"
  cd -P "$(dirname "$file")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$file")"
}

relative_file() {
  local file="$1"
  case "$file" in
    "$ROOT"/*) printf '%s\n' "${file#"$ROOT"/}" ;;
    *) printf '%s\n' "$file" ;;
  esac
}

timeout_for_file() {
  local file="$1"
  case "$file" in
    */samples/large/*|*/samples/quantum/volumes/*|*/samples/schrodinger/*|*/samples/structures/proteins/*)
      printf '%s\n' "$LONG_TIMEOUT_SECONDS"
      ;;
    *)
      printf '%s\n' "$DEFAULT_TIMEOUT_SECONDS"
      ;;
  esac
}

cleanup_quicklook_state() {
  killall qlmanage >/dev/null 2>&1 || true
  killall QuickLookUIService >/dev/null 2>&1 || true
  killall quicklookd >/dev/null 2>&1 || true
}

collect_logs() {
  local output="$1"
  : >"$output"
  local log_file
  for log_file in "${LOG_FILES[@]}"; do
    [[ -f "$log_file" ]] || continue
    cat "$log_file" >>"$output" 2>/dev/null || true
  done
}

log_has_target() {
  local log_snapshot="$1"
  local token="$2"
  grep -F "$token" "$log_snapshot" >/dev/null 2>&1
}

log_has_error() {
  local log_snapshot="$1"
  grep -E 'native build error|JS message type=error|render timeout' "$log_snapshot" >/dev/null 2>&1
}

log_has_success() {
  local log_snapshot="$1"
  grep -E 'JS message type=ready: ready|trace\.requestID=.* state=completed' "$log_snapshot" >/dev/null 2>&1
}

semantic_status=1
semantic_note=""
check_semantic_success() {
  local log_snapshot="$1"
  local preview_file="$2"
  semantic_status=0
  semantic_note="$(bun "$ROOT/scripts/quicklook-semantic-check.mjs" "$log_snapshot" "$preview_file" 2>&1)" || semantic_status=$?
  semantic_note="$(printf '%s' "$semantic_note" | tr '\t' ' ' | tr '\n' ' ' | sed 's/[[:space:]]\{1,\}/ /g; s/[[:space:]]$//')"
  return 0
}

signal_for_log() {
  local log_snapshot="$1"
  if grep -F 'JS message type=ready: ready' "$log_snapshot" >/dev/null 2>&1; then
    printf 'ready\n'
  elif grep -E 'trace\.requestID=.* state=completed' "$log_snapshot" >/dev/null 2>&1; then
    printf 'completed\n'
  else
    printf 'none\n'
  fi
}

detail_for_log() {
  local log_snapshot="$1"
  if [[ ! -s "$log_snapshot" ]]; then
    printf 'no extension log'
    return
  fi
  grep -E 'file\.path=|native build error|JS message type=error|render timeout|resource\.typeIdentifier=|\[build\] detected\.format=|\[build\] detected\.previewMode=|\[build\] textFallback\.|\[build\] trajectory\.|preview\.evidence |Rendered |ready|state=completed' "$log_snapshot" |
    tail -n 8 |
    tr '\t' ' ' |
    tr '\n' ' ' |
    sed 's/[[:space:]]\{1,\}/ /g; s/[[:space:]]$//'
}

run_preview() {
  local content_type="$1"
  local preview_file="$2"

  if [[ "$content_type" == "$BURRETE_XYZ_CONTENT_TYPE" ]]; then
    # qlmanage can abort when forcing XYZ UTIs; normal Quick Look resolves the
    # installed Open Babel alias when Launch Services is healthy.
    qlmanage -p "$preview_file"
  else
    qlmanage -p -c "$content_type" "$preview_file"
  fi
}

if [[ "$RESET_CACHE" == "1" ]]; then
  qlmanage -r >/dev/null 2>&1 || true
  qlmanage -r cache >/dev/null 2>&1 || true
fi

printf 'status\tfile\ttype\tseconds\tsignal\tnote\n' >"$RESULTS_PATH"

total=0
passed=0
failed=0
skipped=0

while IFS= read -r sample_file; do
  [[ -f "$sample_file" ]] || continue
  total=$((total + 1))

  abs_file="$(absolute_file "$sample_file")"
  rel_file="$(relative_file "$abs_file")"
  content_type="$(BURRETE_DEV_FLAVOR="$BURRETE_DEV_FLAVOR" "$ROOT/scripts/preview-content-type.mjs" "$abs_file" 2>/dev/null || true)"
  if [[ -z "$content_type" || "$content_type" == "(null)" ]]; then
    skipped=$((skipped + 1))
    printf 'SKIP\t%s\t-\t0\tnone\tpreview-content-type returned empty\n' "$rel_file" >>"$RESULTS_PATH"
    printf '[%03d] SKIP %s: preview-content-type returned empty\n' "$total" "$rel_file"
    continue
  fi

  timeout_seconds="$(timeout_for_file "$abs_file")"
  token="$BURRETE_DEV_FLAVOR_SLUG-smoke-$total $(basename "$abs_file")"
  tmp_base="${TMPDIR:-/tmp}"
  tmp_base="${tmp_base%/}"
  temp_dir="$(mktemp -d "$tmp_base/BurreteSampleSmoke-${BURRETE_DEV_FLAVOR_SLUG}.XXXXXX")"
  preview_file="$temp_dir/$token"
  ln "$abs_file" "$preview_file" 2>/dev/null || cp -p "$abs_file" "$preview_file"

  cleanup_quicklook_state
  sleep 1

  log_snapshot="$(mktemp "${TMPDIR:-/tmp}/BurreteSampleSmokeLog.XXXXXX")"
  stdout_path="$(mktemp "${TMPDIR:-/tmp}/BurreteSampleSmokeStdout.XXXXXX")"
  started="$SECONDS"
  (
    cd "$ROOT"
    run_preview "$content_type" "$preview_file"
  ) >"$stdout_path" 2>&1 &
  preview_pid=$!

  state="timeout"
  elapsed=0
  semantic_status=1
  semantic_note="semantic check not reached"
  while (( elapsed < timeout_seconds )); do
    sleep 1
    elapsed=$((SECONDS - started))
    collect_logs "$log_snapshot"
    if log_has_target "$log_snapshot" "$token" && log_has_success "$log_snapshot" && ! log_has_error "$log_snapshot"; then
      check_semantic_success "$log_snapshot" "$preview_file"
      if [[ "$semantic_status" -eq 0 ]]; then
        state="passed"
        break
      fi
      if [[ "$semantic_status" -eq 2 ]]; then
        state="skipped"
        break
      fi
    fi
    if ! kill -0 "$preview_pid" 2>/dev/null; then
      state="exited"
      break
    fi
  done

  if kill -0 "$preview_pid" 2>/dev/null; then
    kill "$preview_pid" 2>/dev/null || true
  fi
  wait "$preview_pid" 2>/dev/null || true
  sleep 1
  collect_logs "$log_snapshot"

  elapsed=$((SECONDS - started))
  if log_has_target "$log_snapshot" "$token" && log_has_success "$log_snapshot" && ! log_has_error "$log_snapshot"; then
    check_semantic_success "$log_snapshot" "$preview_file"
  fi

  if log_has_target "$log_snapshot" "$token" && log_has_success "$log_snapshot" && ! log_has_error "$log_snapshot" && [[ "$semantic_status" -eq 0 ]]; then
    passed=$((passed + 1))
    signal="$(signal_for_log "$log_snapshot")"
    note="$signal in ${elapsed}s; $semantic_note"
    printf 'PASS\t%s\t%s\t%s\t%s\t%s\n' "$rel_file" "$content_type" "$elapsed" "$signal" "$note" >>"$RESULTS_PATH"
    printf '[%03d] PASS %s (%s, %ss)\n' "$total" "$rel_file" "$signal" "$elapsed"
  elif log_has_target "$log_snapshot" "$token" && log_has_success "$log_snapshot" && ! log_has_error "$log_snapshot" && [[ "$semantic_status" -eq 2 ]]; then
    skipped=$((skipped + 1))
    signal="$(signal_for_log "$log_snapshot")"
    note="$signal in ${elapsed}s; $semantic_note"
    printf 'SKIP\t%s\t%s\t%s\t%s\t%s\n' "$rel_file" "$content_type" "$elapsed" "$signal" "$note" >>"$RESULTS_PATH"
    printf '[%03d] SKIP %s (%s, %ss) %s\n' "$total" "$rel_file" "$signal" "$elapsed" "$semantic_note"
  else
    failed=$((failed + 1))
    signal="$(signal_for_log "$log_snapshot")"
    detail="$(detail_for_log "$log_snapshot")"
    if ! log_has_target "$log_snapshot" "$token"; then
      detail="no matching extension log for $token; $detail"
    fi
    if [[ -n "$semantic_note" && "$semantic_note" != "semantic check not reached" ]]; then
      detail="$detail; semantic: $semantic_note"
    fi
    printf 'FAIL\t%s\t%s\t%s\t%s\t%s; %s\n' "$rel_file" "$content_type" "$elapsed" "$signal" "$state" "$detail" >>"$RESULTS_PATH"
    printf '[%03d] FAIL %s (%ss) %s\n' "$total" "$rel_file" "$elapsed" "$detail"
  fi

  rm -rf "$temp_dir"
  rm -f "$log_snapshot" "$stdout_path"
done < <(list_sample_files)

cleanup_quicklook_state

{
  printf '# Quick Look Samples Smoke\n\n'
  printf '%s\n' "- Dev flavor: \`$BURRETE_DEV_FLAVOR_SLUG\`"
  printf '%s\n' "- Preview extension: \`$BURRETE_PREVIEW_ID\`"
  printf '%s\n' "- Samples directory: \`$(relative_file "$SAMPLES_DIR")\`"
  printf '%s\n' "- Result: \`$passed passed / $failed failed / $skipped skipped / $total total\`"
  printf '%s\n\n' "- TSV: \`$(relative_file "$RESULTS_PATH")\`"
  if [[ "$failed" -gt 0 ]]; then
    printf '## Failures\n\n'
    awk -F '\t' 'NR > 1 && $1 != "PASS" { printf "%s\n", "- `" $2 "` - " $3 " - " $6 }' "$RESULTS_PATH"
    printf '\n'
  fi
} >"$SUMMARY_PATH"

printf 'SUMMARY pass=%s fail=%s skip=%s total=%s tsv=%s markdown=%s\n' "$passed" "$failed" "$skipped" "$total" "$RESULTS_PATH" "$SUMMARY_PATH"

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
