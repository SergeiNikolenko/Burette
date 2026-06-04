#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APP_ID="com.local.BurreteV10"
EXT_ID="com.local.BurreteV10.Preview"
PDB_CONTENT_TYPE="com.local.burrete10.pdb"
CIF_CONTENT_TYPE="com.local.burrete10.cif"
APP_BUNDLE_NAME="Burrete.app"
IS_DEV_FLAVOR=0
if [[ -n "${BURRETE_DEV_FLAVOR:-}" ]]; then
  command -v bun >/dev/null 2>&1 || { echo "error: BURRETE_DEV_FLAVOR requires bun to compute the dev namespace." >&2; exit 1; }
  eval "$(bun "$ROOT/scripts/dev-namespace.mjs" shell-env)"
  APP_ID="$BURRETE_APP_ID"
  EXT_ID="$BURRETE_PREVIEW_ID"
  PDB_CONTENT_TYPE="$BURRETE_PDB_CONTENT_TYPE"
  CIF_CONTENT_TYPE="${BURRETE_CONTENT_TYPE_PREFIX}cif"
  APP_BUNDLE_NAME="$BURRETE_APP_BUNDLE_NAME"
  IS_DEV_FLAVOR=1
fi
APP="$ROOT/build/$APP_BUNDLE_NAME"
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/$APP_BUNDLE_NAME"
STAGING_DEST="$DEST_DIR/.${APP_BUNDLE_NAME%.app}.installing.app"
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

verify_installed_bundle() {
  local built_version installed_version built_doc_types installed_doc_types
  local built_supported_types installed_supported_types

  built_version="$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")"
  installed_version="$(plutil -extract CFBundleShortVersionString raw -o - "$DEST/Contents/Info.plist")"
  if [[ "$installed_version" != "$built_version" ]]; then
    echo "error: installed app version mismatch: expected $built_version, got ${installed_version:-unknown}" >&2
    exit 1
  fi

  built_doc_types="$(plutil -extract CFBundleDocumentTypes json -o - "$APP/Contents/Info.plist")"
  installed_doc_types="$(plutil -extract CFBundleDocumentTypes json -o - "$DEST/Contents/Info.plist")"
  if [[ "$installed_doc_types" != "$built_doc_types" ]]; then
    echo "error: installed app document types do not match build output" >&2
    exit 1
  fi

  built_supported_types="$(plutil -extract NSExtension.NSExtensionAttributes.QLSupportedContentTypes json -o - "$APP/Contents/PlugIns/BurretePreview.appex/Contents/Info.plist")"
  installed_supported_types="$(plutil -extract NSExtension.NSExtensionAttributes.QLSupportedContentTypes json -o - "$DEST_APPEX/Contents/Info.plist")"
  if [[ "$installed_supported_types" != "$built_supported_types" ]]; then
    echo "error: installed Quick Look supported content types do not match build output" >&2
    exit 1
  fi
}

clean_detritus() {
  local path="$1"
  [[ -e "$path" ]] || return 0
  local attrs=(
    com.apple.FinderInfo
    'com.apple.fileprovider.fpfs#P'
    com.apple.provenance
    com.apple.ResourceFork
  )
  xattr -cr "$path" 2>/dev/null || true
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
    xattr -cr "$path" 2>/dev/null || true
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
pluginkit -r "$EXT_ID" 2>/dev/null || true
if [[ "$IS_DEV_FLAVOR" != "1" ]]; then
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
fi

unregister_bundle "$DEST"
unregister_bundle "$LEGACY_OLD_DEST"
unregister_bundle "$LEGACY_BURET_DEST"
unregister_bundle "$LEGACY_XYZ_DEST"
unregister_bundle "$APP"
if [[ "$IS_DEV_FLAVOR" != "1" ]]; then
  unregister_legacy_launch_services_bundles
fi

assert_bundled_xyzrender_runtime() {
  local runtime="$1"
  local python_root="$2"
  local stage="$3"
  [[ -d "$LOCAL_XYZRENDER_ENV" ]] || return 0
  [[ -f "$runtime/bin/xyzrender" ]] || {
    echo "error: bundled xyzrender runtime disappeared $stage: $runtime/bin/xyzrender" >&2
    exit 1
  }
  [[ -x "$python_root/bin/python3" ]] || {
    echo "error: bundled xyzrender python runtime disappeared $stage: $python_root/bin/python3" >&2
    exit 1
  }
}
assert_bundled_xyzrender_runner() {
  local runtime="$1"
  local python_root="$2"
  local stage="$3"
  assert_bundled_xyzrender_runtime "$runtime" "$python_root" "$stage"
  for attempt in 1 2 3; do
    if "$runtime/bin/xyzrender" --help >/dev/null; then
      return 0
    fi
    [[ "$attempt" == 3 ]] && break
    sleep 1
  done
  echo "error: bundled xyzrender wrapper is not runnable $stage" >&2
  exit 1
}

sign_bundled_xyzrender_runtime() {
  local runtime="$1"
  local python_root="$2"
  [[ -d "$runtime" && -d "$python_root" ]] || return 0
  while IFS= read -r binary; do
    codesign --force --sign - "$binary" >/dev/null
  done < <(
    find "$runtime" "$python_root" -type f \( \
      -name python3 -o \
      -name 'python3.*' -o \
      -name '*.dylib' -o \
      -name '*.so' \
    \)
  )
}

mkdir -p "$DEST_DIR"
rm -rf "$STAGING_DEST" "$DEST" "$LEGACY_OLD_DEST" "$LEGACY_BURET_DEST" "$LEGACY_XYZ_DEST"
if [[ -e "$STAGING_DEST" || -e "$DEST" ]]; then
  echo "error: could not remove previous install staging or destination" >&2
  echo "  staging: $STAGING_DEST" >&2
  echo "  destination: $DEST" >&2
  exit 1
fi
ditto --norsrc --noextattr "$APP" "$STAGING_DEST"
rm -rf "$STAGING_DEST/Contents/Resources/Web" "$STAGING_APPEX/Contents/Resources/Web"
ditto --norsrc --noextattr "$ROOT/PreviewExtension/Web" "$STAGING_DEST/Contents/Resources/Web"
ditto --norsrc --noextattr "$ROOT/PreviewExtension/Web" "$STAGING_APPEX/Contents/Resources/Web"
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
  clean_detritus "$STAGING_XYZRENDER_PYTHON"
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
  codesign --force --sign - "$STAGING_XYZRENDER_PYTHON/bin/python3" >/dev/null
  [[ -f "$STAGING_XYZRENDER_ENV/bin/xyzrender" ]] || {
    echo "error: bundled xyzrender runtime is missing after staging: $STAGING_XYZRENDER_ENV/bin/xyzrender" >&2
    exit 1
  }
  assert_bundled_xyzrender_runtime "$STAGING_XYZRENDER_ENV" "$STAGING_XYZRENDER_PYTHON" "before signing"
fi
codesign --force --sign - --entitlements "$ROOT/PreviewExtension/BurretePreview.entitlements" "$STAGING_APPEX" >/dev/null
if [[ -d "$LOCAL_XYZRENDER_ENV" ]]; then
  sign_bundled_xyzrender_runtime "$STAGING_XYZRENDER_ENV" "$STAGING_XYZRENDER_PYTHON"
fi
codesign --force --sign - "$STAGING_DEST" >/dev/null
if [[ -d "$LOCAL_XYZRENDER_ENV" ]]; then
  assert_bundled_xyzrender_runner "$STAGING_XYZRENDER_ENV" "$STAGING_XYZRENDER_PYTHON" "after signing"
fi
codesign --verify --deep --strict "$STAGING_DEST"
rm -rf "$DEST"
if [[ -e "$DEST" ]]; then
  echo "error: could not remove existing installed app before final move: $DEST" >&2
  exit 1
fi
mv "$STAGING_DEST" "$DEST"
if [[ ! -d "$DEST/Contents" ]]; then
  echo "error: installed app has invalid bundle layout: $DEST/Contents is missing" >&2
  exit 1
fi
if ! cmp -s "$ROOT/PreviewExtension/Web/grid-viewer.js" "$DEST/Contents/Resources/Web/grid-viewer.js"; then
  echo "error: installed app grid viewer does not match PreviewExtension/Web/grid-viewer.js" >&2
  exit 1
fi
if ! cmp -s "$ROOT/PreviewExtension/Web/grid-viewer.js" "$DEST_APPEX/Contents/Resources/Web/grid-viewer.js"; then
  echo "error: installed Quick Look grid viewer does not match PreviewExtension/Web/grid-viewer.js" >&2
  exit 1
fi
if ! cmp -s "$ROOT/PreviewExtension/Web/grid-ui.js" "$DEST/Contents/Resources/Web/grid-ui.js"; then
  echo "error: installed app grid UI does not match PreviewExtension/Web/grid-ui.js" >&2
  exit 1
fi
if ! cmp -s "$ROOT/PreviewExtension/Web/grid-ui.js" "$DEST_APPEX/Contents/Resources/Web/grid-ui.js"; then
  echo "error: installed Quick Look grid UI does not match PreviewExtension/Web/grid-ui.js" >&2
  exit 1
fi
if ! cmp -s "$ROOT/PreviewExtension/Web/grid.css" "$DEST/Contents/Resources/Web/grid.css"; then
  echo "error: installed app grid CSS does not match PreviewExtension/Web/grid.css" >&2
  exit 1
fi
if ! cmp -s "$ROOT/PreviewExtension/Web/grid.css" "$DEST_APPEX/Contents/Resources/Web/grid.css"; then
  echo "error: installed Quick Look grid CSS does not match PreviewExtension/Web/grid.css" >&2
  exit 1
fi
assert_bundled_xyzrender_runner "$DEST_XYZRENDER_ENV" "$DEST_XYZRENDER_PYTHON" "after final move"
verify_installed_bundle
rm -rf "$STAGING_DEST"

[[ -x "$LSREGISTER" ]] && "$LSREGISTER" -f -R "$DEST" || true
assert_bundled_xyzrender_runner "$DEST_XYZRENDER_ENV" "$DEST_XYZRENDER_PYTHON" "after lsregister"
if [[ -x /usr/bin/swift ]]; then
  BURRETE_APP_PATH="$DEST" BURRETE_APP_ID="$APP_ID" BURRETE_IS_DEV_FLAVOR="$IS_DEV_FLAVOR" /usr/bin/swift -e '
import Foundation
import CoreServices

let appURL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["BURRETE_APP_PATH"] ?? "")
let bundleID = (ProcessInfo.processInfo.environment["BURRETE_APP_ID"] ?? "com.local.BurreteV10") as CFString
let isDevFlavor = ProcessInfo.processInfo.environment["BURRETE_IS_DEV_FLAVOR"] == "1"
LSRegisterURL(appURL as CFURL, true)
if !isDevFlavor {
    let bundle = Bundle(url: appURL)
    let documentTypes = bundle?.object(forInfoDictionaryKey: "CFBundleDocumentTypes") as? [[String: Any]] ?? []
    let contentTypes = documentTypes.flatMap { $0["LSItemContentTypes"] as? [String] ?? [] }
    for contentType in Set(contentTypes) {
        LSSetDefaultRoleHandlerForContentType(contentType as CFString, .viewer, bundleID)
    }
}
' >/dev/null 2>&1 || true
fi
assert_bundled_xyzrender_runner "$DEST_XYZRENDER_ENV" "$DEST_XYZRENDER_PYTHON" "after launch services defaults"
[[ -d "$DEST_APPEX" ]] && pluginkit -a "$DEST_APPEX" 2>/dev/null || true
pluginkit -e use -i "$EXT_ID" 2>/dev/null || true
assert_bundled_xyzrender_runner "$DEST_XYZRENDER_ENV" "$DEST_XYZRENDER_PYTHON" "after pluginkit"

qlmanage -r >/dev/null 2>&1 || true
qlmanage -r cache >/dev/null 2>&1 || true
killall quicklookd 2>/dev/null || true
rm -rf "$HOME/Library/Caches/$APP_ID/viewer/assets" 2>/dev/null || true
assert_bundled_xyzrender_runner "$DEST_XYZRENDER_ENV" "$DEST_XYZRENDER_PYTHON" "after quicklook reset"

touch "$ROOT/samples/mini.pdb" "$ROOT/samples/mini.cif" "$ROOT/samples/mini.xyz" 2>/dev/null || true

NORMAL_TESTS=$(
  if [[ "$IS_DEV_FLAVOR" == "1" ]]; then
    cat <<DEV
Normal Finder previews remain globally owned by file extension. For this dev
flavor, prefer the forced tests above.
DEV
  else
    cat <<NORMAL
Normal tests:
  qlmanage -p "$ROOT/samples/mini.pdb"
  qlmanage -p "$ROOT/samples/mini.cif"
  qlmanage -p "$ROOT/tests/fixtures/BurettePreviewSamples/tables/compounds.csv"
  qlmanage -p "$ROOT/tests/fixtures/BurettePreviewSamples/tables/compounds.tsv"
  qlmanage -p "$ROOT/samples/mini.xyz"
NORMAL
  fi
)

cat <<REPORT
Installed local copy:
  $DEST

Check extension registration:
  pluginkit -m -p com.apple.quicklook.preview | grep -i Burrete

Forced tests:
  qlmanage -p -c $PDB_CONTENT_TYPE "$ROOT/samples/mini.pdb"
  qlmanage -p -c $CIF_CONTENT_TYPE "$ROOT/samples/mini.cif"
  qlmanage -p "$ROOT/samples/mini.xyz"

$NORMAL_TESTS

Launch manually when needed:
  open "$DEST"
REPORT
