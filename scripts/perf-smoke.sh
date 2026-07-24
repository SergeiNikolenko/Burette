#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APP="${BURETTE_APP_PATH:-$ROOT/build/Burette.app}"
REPORT="${BURETTE_PERF_REPORT:-$ROOT/build/reports/perf-smoke.txt}"
PDB_FILE="${BURETTE_PERF_PDB:-$ROOT/samples/mini.pdb}"
SDF_FILE="${BURETTE_PERF_SDF:-$ROOT/samples/mini.sdf}"
QUICKLOOK_FILE="${BURETTE_PERF_QUICKLOOK_FILE:-$PDB_FILE}"
TIMEOUT_SECONDS="${BURETTE_PERF_TIMEOUT_SECONDS:-20}"
RUN_GUI="${BURETTE_PERF_RUN_GUI:-1}"
RUN_QUICKLOOK="${BURETTE_PERF_RUN_QUICKLOOK:-1}"
RUN_GRID_FTS="${BURETTE_PERF_RUN_GRID_FTS:-0}"
PROCESS_NAME="${BURETTE_PROCESS_NAME:-Burette}"

mkdir -p "$(dirname "$REPORT")"

now_ms() {
  python3 -c 'import time; print(int(time.time() * 1000))'
}

print_header() {
  printf 'Burette performance smoke report\n'
  printf 'Generated: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'Root: %s\n' "$ROOT"
  printf 'App: %s\n' "$APP"
  printf 'Timeout seconds: %s\n' "$TIMEOUT_SECONDS"
  printf '\n'
}

process_window_count() {
  osascript - "$PROCESS_NAME" <<'OSA' 2>/dev/null || true
on run argv
  set processName to item 1 of argv
  tell application "System Events"
    if exists process processName then
      tell process processName
        return (count of windows) as text
      end tell
    end if
  end tell
  return "-1"
end run
OSA
}

wait_for_first_window() {
  local deadline=$(( $(now_ms) + TIMEOUT_SECONDS * 1000 ))
  local count
  while [[ "$(now_ms)" -lt "$deadline" ]]; do
    count="$(process_window_count | tr -d '\r\n')"
    if [[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]]; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

quit_app() {
  osascript -e 'tell application "Burette" to quit' >/dev/null 2>&1 || true
  sleep 1
}

measure_open() {
  local label="$1"
  shift
  local started ended status
  started="$(now_ms)"
  set +e
  "$@"
  status=$?
  set -e
  ended="$(now_ms)"
  printf '%-34s command_ms=%s status=%s\n' "$label" "$((ended - started))" "$status"
  return "$status"
}

smoke_app_launch() {
  printf '## App Cold Launch Approximation\n\n'
  if [[ "$RUN_GUI" != "1" ]]; then
    echo "Skipped: BURETTE_PERF_RUN_GUI is not 1."
    return 0
  fi
  if [[ ! -d "$APP" ]]; then
    echo "Skipped: app bundle is missing."
    return 0
  fi

  quit_app
  local started status window_status ended
  started="$(now_ms)"
  set +e
  open -n -a "$APP"
  status=$?
  set -e
  if [[ "$status" -ne 0 ]]; then
    ended="$(now_ms)"
    printf 'Failed: open returned status %s after %s ms.\n' "$status" "$((ended - started))"
    return 0
  fi
  if wait_for_first_window; then
    window_status="first_window_seen"
  else
    window_status="first_window_timeout_or_accessibility_denied"
  fi
  ended="$(now_ms)"
  printf 'app_launch_to_%s_ms=%s\n' "$window_status" "$((ended - started))"
}

smoke_open_file() {
  local title="$1"
  local file="$2"
  printf '\n## %s\n\n' "$title"
  if [[ "$RUN_GUI" != "1" ]]; then
    echo "Skipped: BURETTE_PERF_RUN_GUI is not 1."
    return 0
  fi
  if [[ ! -d "$APP" ]]; then
    echo "Skipped: app bundle is missing."
    return 0
  fi
  if [[ ! -f "$file" ]]; then
    printf 'Skipped: file is missing: %s\n' "$file"
    return 0
  fi
  quit_app
  measure_open "open $(basename "$file")" open -n -a "$APP" "$file" || true
  if wait_for_first_window; then
    echo "Result: app window observed."
  else
    echo "Result: app window was not observed before timeout."
  fi
}

smoke_quicklook() {
  printf '\n## Quick Look Preview Smoke\n\n'
  if [[ "$RUN_QUICKLOOK" != "1" ]]; then
    echo "Skipped: BURETTE_PERF_RUN_QUICKLOOK is not 1."
    return 0
  fi
  if [[ ! -f "$QUICKLOOK_FILE" ]]; then
    printf 'Skipped: file is missing: %s\n' "$QUICKLOOK_FILE"
    return 0
  fi
  if ! command -v qlmanage >/dev/null 2>&1; then
    echo "Skipped: qlmanage is not available."
    return 0
  fi

  local metrics_path="$ROOT/build/reports/perf-smoke-quicklook.json"
  local started ended status
  started="$(now_ms)"
  set +e
  RUNS="${BURETTE_QUICKLOOK_RUNS:-1}" \
    TIMEOUT_SECONDS="$TIMEOUT_SECONDS" \
    METRICS_PATH="$metrics_path" \
    "$ROOT/scripts/measure-quicklook-cold-open.sh" "$QUICKLOOK_FILE"
  status=$?
  set -e
  ended="$(now_ms)"
  printf 'quicklook_smoke_command_ms=%s status=%s\n' "$((ended - started))" "$status"
  if [[ -f "$metrics_path" ]]; then
    printf 'metrics: %s\n' "$metrics_path"
    cat "$metrics_path"
  fi
}

smoke_grid_fts() {
  printf '\n## SQLite FTS Grid Search Perf Smoke\n\n'
  if [[ "$RUN_GRID_FTS" != "1" ]]; then
    echo "Skipped: BURETTE_PERF_RUN_GRID_FTS is not 1."
    return 0
  fi
  if ! command -v cargo >/dev/null 2>&1; then
    echo "Skipped: cargo is not available."
    return 0
  fi

  measure_open "grid fts 50k perf test" \
    cargo test \
      --manifest-path "$ROOT/apps/desktop/src-tauri/Cargo.toml" \
      preview::grid_store::tests::fts_search_is_faster_than_like_on_synthetic_collection \
      -- --ignored --nocapture || true
}

generate_report() {
  print_header
  smoke_app_launch
  smoke_open_file "Open Small PDB" "$PDB_FILE"
  smoke_open_file "Open SDF Grid" "$SDF_FILE"
  smoke_quicklook
  smoke_grid_fts
}

generate_report >"$REPORT"
cat "$REPORT"
