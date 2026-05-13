#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${BASH_SOURCE[0]}"
while [[ -L "$SCRIPT" ]]; do
  DIR="$(cd -P "$(dirname "$SCRIPT")" >/dev/null 2>&1 && pwd -P)"
  SCRIPT="$(readlink "$SCRIPT")"
  [[ "$SCRIPT" != /* ]] && SCRIPT="$DIR/$SCRIPT"
done
ROOT="$(cd -P "$(dirname "$SCRIPT")/.." >/dev/null 2>&1 && pwd -P)"
CALLING_DIR="$PWD"
cd "$ROOT"

export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

SAFE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/BurreteSignedNode.XXXXXX")"

cleanup_safe_root() {
  rm -rf "$SAFE_ROOT" 2>/dev/null || true
}
trap cleanup_safe_root EXIT

prepare_signed_node() {
  [[ "$(uname -s)" == "Darwin" ]] || return 0

  local node_source
  node_source="$(node -p 'process.execPath')"
  local node_bin_dir="$SAFE_ROOT/.node-bin"
  local entitlements="$SAFE_ROOT/node-dev.entitlements"
  mkdir -p "$node_bin_dir"
  cat >"$entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
PLIST
  cp "$node_source" "$node_bin_dir/node"
  codesign --force --sign - --entitlements "$entitlements" "$node_bin_dir/node" >/dev/null
  export PATH="$node_bin_dir:$PATH"
}

sign_native_modules() {
  [[ "$(uname -s)" == "Darwin" ]] || return 0
  [[ -d node_modules ]] || return 0

  while IFS= read -r -d '' native_module; do
    codesign --force --sign - "$native_module" >/dev/null 2>&1 || true
  done < <(find node_modules -name '*.node' -type f -print0 2>/dev/null)
}

prepare_signed_node
sign_native_modules

cd "$CALLING_DIR"
exec "$@"
