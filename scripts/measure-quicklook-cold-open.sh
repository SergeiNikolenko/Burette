#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FILE="${1:-$ROOT/samples/mini.pdb}"
RUNS="${RUNS:-3}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-30}"
CONTAINER_BASE="$HOME/Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete"
LOG_PATH="$CONTAINER_BASE/Burrete.log"
METRICS_PATH="$ROOT/metrics.json"

if [[ ! -f "$FILE" ]]; then
  echo "error: structure file not found: $FILE" >&2
  exit 1
fi

if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [[ "$RUNS" -lt 1 ]]; then
  echo "error: RUNS must be a positive integer" >&2
  exit 1
fi

if ! [[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SECONDS" -lt 1 ]]; then
  echo "error: TIMEOUT_SECONDS must be a positive integer" >&2
  exit 1
fi

TYPE="$("$ROOT/scripts/preview-content-type.mjs" "$FILE")"
if [[ -z "$TYPE" ]]; then
  TYPE="$(mdls -raw -name kMDItemContentType "$FILE" 2>/dev/null || true)"
fi
if [[ -z "$TYPE" ]]; then
  echo "error: could not determine content type for $FILE" >&2
  exit 1
fi

cleanup_preview_state() {
  pkill -f 'qlmanage -p' 2>/dev/null || true
  pkill -f 'qlmanage -x -p' 2>/dev/null || true
  rm -rf "$CONTAINER_BASE"
  mkdir -p "$CONTAINER_BASE"
  qlmanage -r >/dev/null 2>&1 || true
  qlmanage -r cache >/dev/null 2>&1 || true
  killall quicklookd 2>/dev/null || true
}

cleanup_run() {
  local pid="${1:-}"
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

TMP_RESULTS="$(mktemp "${TMPDIR:-/tmp}/burrete-cold-open-results.XXXXXX.jsonl")"
trap 'rm -f "$TMP_RESULTS"' EXIT

for run in $(seq 1 "$RUNS"); do
  cleanup_preview_state
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/burrete-cold-open-run${run}.XXXXXX")"
  temp_input="$temp_dir/input.${FILE##*.}"
  cp "$FILE" "$temp_input"
  temp_input="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$temp_input")"
  temp_stdout="$(mktemp "${TMPDIR:-/tmp}/burrete-cold-open-stdout.XXXXXX")"
  (
    cd "$ROOT"
    qlmanage -x -p -c "$TYPE" "$temp_input"
  ) >"$temp_stdout" 2>&1 &
  ql_pid=$!

  python3 - "$LOG_PATH" "$temp_input" "$TIMEOUT_SECONDS" "$run" >>"$TMP_RESULTS" <<'PY'
from __future__ import annotations

import json
import os
import pathlib
import re
import sys
import time

log_path = pathlib.Path(sys.argv[1])
target_path = os.path.realpath(sys.argv[2])
timeout_seconds = int(sys.argv[3])
run = int(sys.argv[4])

prepare_re = re.compile(r"^\[(?P<ts>\d{2}:\d{2}:\d{2}\.\d{3})\] \[(?P<id>[A-F0-9]+)\] preparePreviewOfFile called$")
file_re = re.compile(r"^\[(?P<ts>\d{2}:\d{2}:\d{2}\.\d{3})\] \[(?P<id>[A-F0-9]+)\] file\.path=(?P<path>.+)$")
html_re = re.compile(r"^\[(?P<ts>\d{2}:\d{2}:\d{2}\.\d{3})\] \[(?P<id>[A-F0-9]+)\] calling WKWebView\.loadFileURL; html\.bytes=(?P<html_bytes>\d+);")
rendered_re = re.compile(r"^\[(?P<ts>\d{2}:\d{2}:\d{2}\.\d{3})\] \[(?P<id>[A-F0-9]+)\] JS message type=status: \[web\] Rendered ")
ready_re = re.compile(r"^\[(?P<ts>\d{2}:\d{2}:\d{2}\.\d{3})\] \[(?P<id>[A-F0-9]+)\] JS message type=ready: ready$")

def parse_ms(value: str) -> int:
    hh, mm, tail = value.split(":")
    ss, ms = tail.split(".")
    return ((int(hh) * 60 + int(mm)) * 60 + int(ss)) * 1000 + int(ms)

deadline = time.time() + timeout_seconds
request_id: str | None = None
prepare_ms: int | None = None
rendered_ms: int | None = None
ready_ms: int | None = None
html_bytes: int | None = None

while time.time() < deadline:
    if log_path.exists():
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        for line in lines:
            match = file_re.match(line)
            if match and os.path.realpath(match.group("path")) == target_path:
                request_id = match.group("id")
        if request_id:
            for line in lines:
                if prepare_ms is None:
                    match = prepare_re.match(line)
                    if match and match.group("id") == request_id:
                        prepare_ms = parse_ms(match.group("ts"))
                        continue
                if html_bytes is None:
                    match = html_re.match(line)
                    if match and match.group("id") == request_id:
                        html_bytes = int(match.group("html_bytes"))
                        continue
                if rendered_ms is None:
                    match = rendered_re.match(line)
                    if match and match.group("id") == request_id:
                        rendered_ms = parse_ms(match.group("ts"))
                        continue
                if ready_ms is None:
                    match = ready_re.match(line)
                    if match and match.group("id") == request_id:
                        ready_ms = parse_ms(match.group("ts"))
                        continue
            if prepare_ms is not None and rendered_ms is not None and ready_ms is not None:
                break
    time.sleep(0.1)

if request_id is None or prepare_ms is None or rendered_ms is None or ready_ms is None:
    raise SystemExit(f"Timed out waiting for Quick Look cold-open run {run} to finish for {target_path}")

result = {
    "run": run,
    "request_id": request_id,
    "prepare_to_rendered_ms": rendered_ms - prepare_ms,
    "prepare_to_ready_ms": ready_ms - prepare_ms,
    "html_bytes": html_bytes,
}
print(json.dumps(result))
PY

  cleanup_run "$ql_pid"
  rm -rf "$temp_dir" "$temp_stdout"
done

python3 - "$TMP_RESULTS" "$METRICS_PATH" "$FILE" "$TYPE" "$RUNS" <<'PY'
from __future__ import annotations

import json
import pathlib
import statistics
import sys

results_path = pathlib.Path(sys.argv[1])
metrics_path = pathlib.Path(sys.argv[2])
file_path = sys.argv[3]
content_type = sys.argv[4]
runs = int(sys.argv[5])

rows = [json.loads(line) for line in results_path.read_text(encoding="utf-8").splitlines() if line.strip()]
rendered = [row["prepare_to_rendered_ms"] for row in rows]
ready = [row["prepare_to_ready_ms"] for row in rows]
html_bytes = [row.get("html_bytes") for row in rows if row.get("html_bytes") is not None]

metrics = {
    "file": file_path,
    "content_type": content_type,
    "runs": runs,
    "mean_prepare_to_rendered_ms": statistics.fmean(rendered),
    "mean_prepare_to_ready_ms": statistics.fmean(ready),
    "min_prepare_to_rendered_ms": min(rendered),
    "min_prepare_to_ready_ms": min(ready),
    "max_prepare_to_rendered_ms": max(rendered),
    "max_prepare_to_ready_ms": max(ready),
    "mean_html_bytes": statistics.fmean(html_bytes) if html_bytes else None,
    "samples": rows,
}
metrics_path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
print(json.dumps(metrics, indent=2))
PY
