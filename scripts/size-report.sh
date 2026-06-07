#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APP="${BURRETE_APP_PATH:-$ROOT/build/Burrete.app}"
REPORT="${BURRETE_SIZE_REPORT:-$ROOT/build/reports/size-report.txt}"

mkdir -p "$(dirname "$REPORT")"

human_bytes() {
  awk -v bytes="${1:-0}" '
    function human(value) {
      split("B KiB MiB GiB TiB", units, " ")
      unit = 1
      while (value >= 1024 && unit < 5) {
        value /= 1024
        unit += 1
      }
      if (unit == 1) return sprintf("%d %s", value, units[unit])
      return sprintf("%.1f %s", value, units[unit])
    }
    BEGIN { print human(bytes) }
  '
}

file_bytes() {
  local path="$1"
  if [[ -f "$path" ]]; then
    stat -f '%z' "$path"
  elif [[ -d "$path" ]]; then
    du -sk "$path" | awk '{ print $1 * 1024 }'
  else
    printf '0\n'
  fi
}

print_path_size() {
  local label="$1"
  local path="$2"
  if [[ -e "$path" ]]; then
    local bytes
    bytes="$(file_bytes "$path")"
    printf '%-34s %12s  %s\n' "$label" "$(human_bytes "$bytes")" "$path"
  else
    printf '%-34s %12s  %s\n' "$label" "missing" "$path"
  fi
}

print_section() {
  printf '\n## %s\n\n' "$1"
}

print_file_matches() {
  local title="$1"
  shift
  print_section "$title"
  if [[ ! -d "$APP" ]]; then
    echo "App bundle is missing."
    return 0
  fi
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/burrete-size-matches.XXXXXX")"
  trap 'rm -f "$tmp"' RETURN
  find "$APP" -type f "$@" -print0 2>/dev/null |
    while IFS= read -r -d '' file; do
      local bytes rel
      bytes="$(stat -f '%z' "$file")"
      rel="${file#$APP/}"
      printf '%12d  %9s  %s\n' "$bytes" "$(human_bytes "$bytes")" "$rel"
    done |
    sort -rn >"$tmp"
  if [[ -s "$tmp" ]]; then
    cat "$tmp"
  else
    echo "No matching files found."
  fi
}

print_directory_summary() {
  local title="$1"
  shift
  print_section "$title"
  local path
  for path in "$@"; do
    print_path_size "$(basename "$path")" "$path"
  done
}

print_web_bundle_locations() {
  print_section "Web Bundle Locations"
  local desktop_app_web="$APP/Contents/Resources/Web"
  local desktop_web="$APP/Contents/Resources/ViewerWeb"
  local appex_web="$APP/Contents/PlugIns/BurretePreview.appex/Contents/Resources/Web"
  print_path_size "Desktop App Web" "$desktop_app_web"
  print_path_size "Desktop Viewer Web" "$desktop_web"
  print_path_size "Quick Look Web" "$appex_web"
}

print_web_runtime_profiles() {
  print_section "Web Runtime Profiles"
  local profiles="$ROOT/config/web-runtime-profiles.json"
  if [[ ! -f "$profiles" ]]; then
    echo "Web runtime profile manifest is missing: $profiles"
    return 0
  fi
  local js_runtime=""
  if command -v node >/dev/null 2>&1; then
    js_runtime="node"
  fi
  if [[ -z "$js_runtime" ]]; then
    echo "Node.js is required to summarize web runtime profiles."
    return 0
  fi
  ROOT="$ROOT" "$js_runtime" <<'JS'
const fs = require('fs');
const path = require('path');

const root = process.env.ROOT;
const manifestPath = path.join(root, 'config', 'web-runtime-profiles.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sourceRoot = path.join(root, manifest.sourceRoot);

function human(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
}

for (const [name, files] of Object.entries(manifest.profiles)) {
  const entries = files.map((file) => {
    const absolutePath = path.join(sourceRoot, file);
    const bytes = fs.existsSync(absolutePath) ? fs.statSync(absolutePath).size : 0;
    return { file, bytes, exists: fs.existsSync(absolutePath) };
  });
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`${name}: ${human(total)} across ${entries.length} files`);
  for (const entry of entries) {
    const size = entry.exists ? human(entry.bytes).padStart(9) : 'missing'.padStart(9);
    console.log(`  ${size}  ${entry.file}`);
  }
}

console.log('');
console.log('Profile membership by asset:');
const memberships = new Map();
for (const [name, files] of Object.entries(manifest.profiles)) {
  for (const file of files) {
    const names = memberships.get(file) || [];
    names.push(name);
    memberships.set(file, names);
  }
}
for (const [file, names] of [...memberships.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${file}: ${names.join(', ')}`);
}

console.log('');
console.log('Bundle targets:');
for (const [target, config] of Object.entries(manifest.bundleTargets || {})) {
  console.log(`  ${target}: ${(config.profiles || []).join(', ')}`);
  console.log(`    resource: ${config.resourceRoot}`);
}
JS
}

print_web_asset_duplication() {
  print_section "Web Bundle Duplication Candidates"
  echo "Profile membership above explains which desktop and Quick Look runtimes intentionally reference shared Web assets."
  echo "Rows here identify byte-identical files that are duplicated when both bundles package the shared Web folder."
  echo
  local desktop_web="$APP/Contents/Resources/ViewerWeb"
  local appex_web="$APP/Contents/PlugIns/BurretePreview.appex/Contents/Resources/Web"
  local names=(
    "molstar.js"
    "molstar.css"
    "viewer-runtime.css"
    "viewer-shell.js"
    "burette-agent.js"
    "viewer.js"
    "grid-ui.js"
    "grid-viewer.js"
    "grid.css"
    "rdkit/RDKit_minimal.js"
    "rdkit/RDKit_minimal.wasm"
  )
  if [[ ! -d "$desktop_web" || ! -d "$appex_web" ]]; then
    echo "Desktop or Quick Look Web bundle is missing."
    echo "Expected desktop path: $desktop_web"
    echo "Expected Quick Look path: $appex_web"
    return 0
  fi

  printf '%12s  %-9s  %-12s  %s\n' "bytes" "same-sha" "asset" "paths"
  local name desktop_file appex_file desktop_hash appex_hash bytes same
  for name in "${names[@]}"; do
    desktop_file="$desktop_web/$name"
    appex_file="$appex_web/$name"
    if [[ ! -f "$desktop_file" || ! -f "$appex_file" ]]; then
      printf '%12s  %-9s  %-12s  %s | %s\n' "missing" "n/a" "$name" "$desktop_file" "$appex_file"
      continue
    fi
    desktop_hash="$(shasum -a 256 "$desktop_file" | awk '{ print $1 }')"
    appex_hash="$(shasum -a 256 "$appex_file" | awk '{ print $1 }')"
    bytes="$(stat -f '%z' "$desktop_file")"
    if [[ "$desktop_hash" == "$appex_hash" ]]; then
      same="yes"
    else
      same="no"
    fi
    printf '%12d  %-9s  %-12s  %s | %s\n' "$bytes" "$same" "$name" "${desktop_file#$APP/}" "${appex_file#$APP/}"
  done
}

generate_report() {
  printf 'Burrete size report\n'
  printf 'Generated: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'Root: %s\n' "$ROOT"
  printf 'App: %s\n' "$APP"

  print_section "Bundle Size"
  print_path_size "Burrete.app" "$APP"

  print_section "Archives"
  if [[ -d "$ROOT/build" ]]; then
    local archive_count=0
    while IFS= read -r -d '' archive; do
      archive_count=$((archive_count + 1))
      print_path_size "$(basename "$archive")" "$archive"
    done < <(find "$ROOT/build" -maxdepth 5 -type f \( -iname '*.zip' -o -iname '*.dmg' \) -print0 2>/dev/null)
    if [[ "$archive_count" -eq 0 ]]; then
      echo "No zip or dmg artifacts found under build/."
    fi
  else
    echo "build/ is missing."
  fi

  print_section "Top 100 Files"
  if [[ -d "$APP" ]]; then
    find "$APP" -type f -print0 |
      while IFS= read -r -d '' file; do
        bytes="$(stat -f '%z' "$file")"
        printf '%12d  %9s  %s\n' "$bytes" "$(human_bytes "$bytes")" "${file#$APP/}"
      done |
      sort -rn |
      head -n 100
  else
    echo "App bundle is missing."
  fi

  print_section "Exact Duplicate Files By SHA256"
  if [[ -d "$APP" ]]; then
    local hashes
    hashes="$(mktemp "${TMPDIR:-/tmp}/burrete-size-hashes.XXXXXX")"
    find "$APP" -type f -print0 |
      while IFS= read -r -d '' file; do
        shasum -a 256 "$file" | awk -v path="${file#$APP/}" '{ print $1 "\t" path }'
      done >"$hashes"
    awk -F '\t' '
      {
        count[$1] += 1
        paths[$1] = paths[$1] "\n  - " $2
      }
      END {
        found = 0
        for (hash in count) {
          if (count[hash] > 1) {
            found = 1
            print hash " (" count[hash] " files)" paths[hash] "\n"
          }
        }
        if (!found) print "No exact duplicate files found."
      }
    ' "$hashes"
    rm -f "$hashes"
  else
    echo "App bundle is missing."
  fi

  print_file_matches "Molstar Assets" \( -iname '*molstar*' \)
  print_file_matches "RDKit Assets" \( -ipath '*/rdkit/*' -o -iname '*rdkit*' \)
  print_file_matches "Ketcher Assets" \( -iname '*ketcher*' \)
  print_file_matches "Tauri Binary" \( -path '*/Contents/MacOS/*' \)
  print_directory_summary "Quick Look Extension" \
    "$APP/Contents/PlugIns/BurretePreview.appex"
  print_directory_summary "Web Assets" \
    "$APP/Contents/Resources/Web" \
    "$APP/Contents/Resources/ViewerWeb" \
    "$APP/Contents/PlugIns/BurretePreview.appex/Contents/Resources/Web"
  print_web_bundle_locations
  print_web_runtime_profiles
  print_web_asset_duplication
}

generate_report >"$REPORT"
cat "$REPORT"
