#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APP="$ROOT/build/Burrete.app"
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/Burrete.app"
STAGING_DEST="$DEST_DIR/.Burrete.installing.app"
LOCAL_XYZRENDER_ENV="$HOME/.local/share/uv/tools/xyzrender"
DEST_XYZRENDER_ENV="$DEST/Contents/Resources/xyzrender-runtime"
STAGING_XYZRENDER_ENV="$STAGING_DEST/Contents/Resources/xyzrender-runtime"
LOCAL_XYZRENDER_PYTHON_HOME="$(sed -n 's/^home = //p' "$LOCAL_XYZRENDER_ENV/pyvenv.cfg" 2>/dev/null | head -n 1 || true)"
LOCAL_XYZRENDER_PYTHON_ROOT=""
if [[ -n "$LOCAL_XYZRENDER_PYTHON_HOME" ]]; then
  LOCAL_XYZRENDER_PYTHON_ROOT="$(cd -P "$LOCAL_XYZRENDER_PYTHON_HOME/.." && pwd -P)"
fi
DEST_XYZRENDER_PYTHON="$DEST/Contents/Resources/xyzrender-python"
STAGING_XYZRENDER_PYTHON="$STAGING_DEST/Contents/Resources/xyzrender-python"
LEGACY_OLD_DEST="$DEST_DIR/Bur""ette.app"
LEGACY_BURET_DEST="$DEST_DIR/Buret.app"
LEGACY_XYZ_DEST="$DEST_DIR/Burette XYZRender.app"
STAGING_APPEX="$STAGING_DEST/Contents/PlugIns/BurretePreview.appex"
DEST_APPEX="$DEST/Contents/PlugIns/BurretePreview.appex"
EXT_ID="com.local.BurreteV10.Preview"
APP_ID="com.local.BurreteV10"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [[ ! -d "$APP" ]]; then
  echo "error: built app not found: $APP" >&2
  echo "Run ./scripts/build.sh first and make sure it ends with BUILD SUCCEEDED." >&2
  exit 1
fi
if [[ ! -x "$APP/Contents/MacOS/burrete" ]]; then
  echo "error: built Tauri app executable is missing: $APP/Contents/MacOS/burrete" >&2
  echo "Do not run install.sh after a failed build. Re-run: ./scripts/build.sh && ./scripts/install.sh" >&2
  exit 1
fi
actual_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist" 2>/dev/null || true)"
if [[ "$actual_id" != "$APP_ID" ]]; then
  echo "error: built app has unexpected bundle id: ${actual_id:-unknown}" >&2
  echo "Expected: $APP_ID" >&2
  echo "Delete old project copies and rebuild v10 from a clean folder." >&2
  exit 1
fi

clean_detritus() {
  local path="$1"
  [[ -e "$path" ]] || return 0
  local attrs=(
    com.apple.FinderInfo
    'com.apple.fileprovider.fpfs#P'
    com.apple.provenance
    com.apple.ResourceFork
  )
  clean_bundle() {
    local bundle="$1"
    xattr -cr "$bundle" 2>/dev/null || true
    dot_clean -m "$bundle" 2>/dev/null || true
    while IFS= read -r -d '' entry; do
      for attr in "${attrs[@]}"; do
        xattr -d "$attr" "$entry" 2>/dev/null || true
      done
    done < <(find "$bundle" -print0 2>/dev/null)
  }
  for attr in "${attrs[@]}"; do
    xattr -d "$attr" "$path" 2>/dev/null || true
  done
  if [[ "$path" == *.app || "$path" == *.appex ]]; then
    clean_bundle "$path"
  elif [[ -d "$path" ]]; then
    find "$path" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
    while IFS= read -r -d '' bundle; do
      clean_bundle "$bundle"
    done < <(find "$path" -type d \( -name '*.app' -o -name '*.appex' \) -prune -print0 2>/dev/null)
  fi
}
unregister_bundle() {
  local bundle_path="$1"
  [[ -x "$LSREGISTER" ]] || return 0
  [[ -n "$bundle_path" ]] || return 0
  "$LSREGISTER" -u "$bundle_path" 2>/dev/null || true
}
unregister_legacy_launch_services_bundles() {
  [[ -x "$LSREGISTER" ]] || return 0
  "$LSREGISTER" -dump 2>/dev/null |
    awk '
      $1 == "path:" {
        path = substr($0, index($0, $2))
        sub(/ \(0x[0-9a-fA-F]+\)$/, "", path)
        next
      }
      $1 == "identifier:" {
        if ($2 ~ /^com\.local\.(Burrete|Burette|MolstarQuickLook)/) {
          print path
        }
      }
    ' |
    sort -u |
    while IFS= read -r bundle_path; do
      unregister_bundle "$bundle_path"
    done
}
echo "Unregistering old Burrete extensions, if any..."
pkill -f "$DEST/Contents/MacOS/Burrete" 2>/dev/null || true
pkill -f "$DEST/Contents/MacOS/burrete" 2>/dev/null || true
pkill -f "$LEGACY_OLD_DEST/Contents/MacOS/MolstarQuickLook" 2>/dev/null || true
pkill -f "$LEGACY_XYZ_DEST" 2>/dev/null || true
pkill -f "$ROOT/build/Build/Products/Debug/MolstarQuickLook" 2>/dev/null || true
for OLD_ID in \
  com.local.Burrete.Preview \
  com.local.BurreteV4.Preview \
  com.local.BurreteV5.Preview \
  com.local.BurreteV6.Preview \
  com.local.BurreteV7.Preview \
  com.local.BurreteV8.Preview \
  com.local.BurreteV9.Preview \
  com.local.BurreteV10.Preview \
  com.local.BuretteXyzRender.Preview \
  com.local.MolstarQuickLook.Preview \
  com.local.MolstarQuickLookV8.Preview \
  com.local.MolstarQuickLookV10.Preview
do
  pluginkit -r "$OLD_ID" 2>/dev/null || true
done
while IFS= read -r OLD_ENTRY; do
  OLD_APPEX="${OLD_ENTRY##*$'\t'}"
  if [[ "$OLD_APPEX" == *Burrete*.appex || "$OLD_APPEX" == *Burette*.appex || "$OLD_APPEX" == *MolstarQuickLook*.appex ]]; then
    pluginkit -r "$OLD_APPEX" 2>/dev/null || true
  fi
done < <(pluginkit -m -v -p com.apple.quicklook.preview 2>/dev/null | grep -Ei 'Burrete|Burette|MolstarQuickLook' || true)
while IFS= read -r OLD_APPEX; do
  [[ "$OLD_APPEX" == "$DEST_APPEX" ]] && continue
  if [[ "$OLD_APPEX" == *Burrete*.appex || "$OLD_APPEX" == *Burette*.appex || "$OLD_APPEX" == *MolstarQuickLook*.appex ]]; then
    pluginkit -r "$OLD_APPEX" 2>/dev/null || true
    if [[ "$OLD_APPEX" == */Contents/PlugIns/*.appex ]]; then
      unregister_bundle "${OLD_APPEX%/Contents/PlugIns/*}.app"
    fi
  fi
done < <(pluginkit -m -A -D -vvv -p com.apple.quicklook.preview 2>/dev/null | sed -n 's/^[[:space:]]*Path = //p' | grep -Ei 'Burrete|Burette|MolstarQuickLook' || true)

unregister_bundle "$DEST"
unregister_bundle "$LEGACY_OLD_DEST"
unregister_bundle "$LEGACY_BURET_DEST"
unregister_bundle "$LEGACY_XYZ_DEST"
unregister_bundle "$APP"
unregister_legacy_launch_services_bundles

assert_bundled_xyzrender_runtime() {
  local stage="$1"
  [[ -d "$LOCAL_XYZRENDER_ENV" ]] || return 0
  [[ -f "$DEST_XYZRENDER_ENV/bin/xyzrender" ]] || {
    echo "error: bundled xyzrender runtime disappeared $stage: $DEST_XYZRENDER_ENV/bin/xyzrender" >&2
    exit 1
  }
  [[ -x "$DEST_XYZRENDER_PYTHON/bin/python3" ]] || {
    echo "error: bundled xyzrender python runtime disappeared $stage: $DEST_XYZRENDER_PYTHON/bin/python3" >&2
    exit 1
  }
  "$DEST_XYZRENDER_ENV/bin/xyzrender" --help >/dev/null || {
    echo "error: bundled xyzrender wrapper is not runnable $stage" >&2
    exit 1
  }
}

mkdir -p "$DEST_DIR"
rm -rf "$STAGING_DEST" "$DEST" "$LEGACY_OLD_DEST" "$LEGACY_BURET_DEST" "$LEGACY_XYZ_DEST"
ditto --norsrc --noextattr "$APP" "$STAGING_DEST"
if [[ -d "$LOCAL_XYZRENDER_ENV" ]]; then
  [[ -n "$LOCAL_XYZRENDER_PYTHON_ROOT" && -x "$LOCAL_XYZRENDER_PYTHON_ROOT/bin/python3" ]] || {
    echo "error: could not resolve relocatable xyzrender python runtime from $LOCAL_XYZRENDER_ENV/pyvenv.cfg" >&2
    exit 1
  }
  rm -rf "$STAGING_XYZRENDER_ENV"
  mkdir -p "$STAGING_XYZRENDER_ENV"
  rsync -aL --delete "$LOCAL_XYZRENDER_ENV/" "$STAGING_XYZRENDER_ENV/"
  rm -rf "$STAGING_XYZRENDER_PYTHON"
  mkdir -p "$STAGING_XYZRENDER_PYTHON"
  rsync -aL --delete "$LOCAL_XYZRENDER_PYTHON_ROOT/" "$STAGING_XYZRENDER_PYTHON/"
  cat >"$STAGING_XYZRENDER_ENV/bin/xyzrender" <<'EOF'
#!/bin/sh
set -eu

SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RUNTIME_ROOT="$(CDPATH= cd -- "$SELF_DIR/.." && pwd)"
PYTHON_ROOT="$(CDPATH= cd -- "$RUNTIME_ROOT/../xyzrender-python" && pwd)"
SITE_PACKAGES="$(find "$RUNTIME_ROOT/lib" -maxdepth 2 -type d -name site-packages | head -n 1)"

if [ ! -x "$PYTHON_ROOT/bin/python3" ]; then
  echo "missing bundled python runtime: $PYTHON_ROOT/bin/python3" >&2
  exit 1
fi
if [ -z "$SITE_PACKAGES" ] || [ ! -d "$SITE_PACKAGES" ]; then
  echo "missing bundled site-packages under $RUNTIME_ROOT/lib" >&2
  exit 1
fi

PYTHONNOUSERSITE=1 \
PYTHONPATH="$SITE_PACKAGES" \
exec "$PYTHON_ROOT/bin/python3" -m xyzrender.cli "$@"
EOF
  chmod +x "$STAGING_XYZRENDER_ENV/bin/xyzrender"
  clean_detritus "$STAGING_XYZRENDER_ENV"
  [[ -f "$STAGING_XYZRENDER_ENV/bin/xyzrender" ]] || {
    echo "error: bundled xyzrender runtime is missing after staging: $STAGING_XYZRENDER_ENV/bin/xyzrender" >&2
    exit 1
  }
  "$STAGING_XYZRENDER_ENV/bin/xyzrender" --help >/dev/null || {
    echo "error: bundled xyzrender wrapper is not runnable before signing" >&2
    exit 1
  }
fi
codesign --force --sign - --entitlements "$ROOT/PreviewExtension/BurretePreview.entitlements" "$STAGING_APPEX" >/dev/null
codesign --force --sign - "$STAGING_DEST" >/dev/null
if [[ -d "$LOCAL_XYZRENDER_ENV" ]]; then
  [[ -f "$STAGING_XYZRENDER_ENV/bin/xyzrender" ]] || {
    echo "error: bundled xyzrender runtime disappeared before verification: $STAGING_XYZRENDER_ENV/bin/xyzrender" >&2
    exit 1
  }
  "$STAGING_XYZRENDER_ENV/bin/xyzrender" --help >/dev/null || {
    echo "error: bundled xyzrender wrapper is not runnable after signing" >&2
    exit 1
  }
fi
codesign --verify --deep --strict "$STAGING_DEST"
mv "$STAGING_DEST" "$DEST"
assert_bundled_xyzrender_runtime "after final move"

[[ -x "$LSREGISTER" ]] && "$LSREGISTER" -f -R "$DEST" || true
assert_bundled_xyzrender_runtime "after lsregister"
if [[ -x /usr/bin/swift ]]; then
  BURRETE_APP_PATH="$DEST" /usr/bin/swift -e '
import Foundation
import CoreServices

let appURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["BURRETE_APP_PATH"] ?? "")
let bundleID = "com.local.BurreteV10" as CFString
LSRegisterURL(appURL as CFURL, true)
let bundle = Bundle(url: appURL)
let documentTypes = bundle?.object(forInfoDictionaryKey: "CFBundleDocumentTypes") as? [[String: Any]] ?? []
let contentTypes = documentTypes.flatMap { $0["LSItemContentTypes"] as? [String] ?? [] }
let broadPublicTypes: Set<String> = [
    "public.comma-separated-values-text",
    "public.tab-separated-values-text",
]
for contentType in Set(contentTypes).subtracting(broadPublicTypes) {
    LSSetDefaultRoleHandlerForContentType(contentType as CFString, .viewer, bundleID)
}
' >/dev/null 2>&1 || true
fi
assert_bundled_xyzrender_runtime "after launch services defaults"
[[ -d "$DEST_APPEX" ]] && pluginkit -a "$DEST_APPEX" 2>/dev/null || true
pluginkit -e use -i "$EXT_ID" 2>/dev/null || true
assert_bundled_xyzrender_runtime "after pluginkit"

qlmanage -r >/dev/null 2>&1 || true
qlmanage -r cache >/dev/null 2>&1 || true
killall quicklookd 2>/dev/null || true
assert_bundled_xyzrender_runtime "after quicklook reset"

touch "$ROOT/samples/mini.pdb" "$ROOT/samples/mini.cif" "$ROOT/samples/mini.xyz" 2>/dev/null || true

cat <<REPORT
Installed local copy:
  $DEST

Check extension registration:
  pluginkit -m -p com.apple.quicklook.preview | grep -i Burrete

Forced tests:
  qlmanage -p -c com.local.burrete10.pdb "$ROOT/samples/mini.pdb"
  qlmanage -p -c com.local.burrete10.cif "$ROOT/samples/mini.cif"
  qlmanage -p -c com.local.burrete10.xyz "$ROOT/samples/mini.xyz"

Normal tests:
  qlmanage -p "$ROOT/samples/mini.pdb"
  qlmanage -p "$ROOT/samples/mini.cif"
  qlmanage -p "$ROOT/samples/mini.xyz"

Launch manually when needed:
  open "$DEST"
REPORT
