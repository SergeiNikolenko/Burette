#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
APP="$ROOT/build/Build/Products/Debug/Burrete.app"
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/Burrete.app"
LEGACY_BURETTE_DEST="$DEST_DIR/Burette.app"
LEGACY_BURET_DEST="$DEST_DIR/Buret.app"
APPEX="$DEST/Contents/PlugIns/BurretePreview.appex"
EXT_ID="com.local.BurreteV10.Preview"
APP_ID="com.local.BurreteV10"

if [[ ! -d "$APP" ]]; then
  echo "error: built app not found: $APP" >&2
  echo "Run ./scripts/build.sh first and make sure it ends with BUILD SUCCEEDED." >&2
  exit 1
fi
if [[ ! -x "$APP/Contents/MacOS/Burrete" ]]; then
  echo "error: built app executable is missing: $APP/Contents/MacOS/Burrete" >&2
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

clean_detritus() { local path="$1"; [[ -e "$path" ]] || return 0; xattr -cr "$path" 2>/dev/null || true; dot_clean -m "$path" 2>/dev/null || true; find "$path" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true; }

echo "Unregistering old Burrete extensions, if any..."
for OLD_ID in \
  com.local.Burrete.Preview \
  com.local.BurreteV4.Preview \
  com.local.BurreteV5.Preview \
  com.local.BurreteV6.Preview \
  com.local.BurreteV7.Preview \
  com.local.BurreteV8.Preview \
  com.local.BurreteV9.Preview \
  com.local.BurreteV10.Preview
do
  pluginkit -r "$OLD_ID" 2>/dev/null || true
done
while IFS= read -r OLD_ENTRY; do
  OLD_APPEX="${OLD_ENTRY##*$'\t'}"
  if [[ "$OLD_APPEX" == *Burrete*.appex ]]; then
    pluginkit -r "$OLD_APPEX" 2>/dev/null || true
  fi
done < <(pluginkit -m -v -p com.apple.quicklook.preview 2>/dev/null | grep -i Burrete || true)

mkdir -p "$DEST_DIR"
rm -rf "$DEST" "$LEGACY_BURETTE_DEST" "$LEGACY_BURET_DEST"
COPYFILE_DISABLE=1 COPY_EXTENDED_ATTRIBUTES_DISABLE=1 cp -R "$APP" "$DEST"
clean_detritus "$DEST"

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[[ -x "$LSREGISTER" ]] && "$LSREGISTER" -f -R "$DEST" || true
[[ -d "$APPEX" ]] && pluginkit -a "$APPEX" 2>/dev/null || true
pluginkit -e use -i "$EXT_ID" 2>/dev/null || true

open "$DEST" || true
qlmanage -r >/dev/null 2>&1 || true
qlmanage -r cache >/dev/null 2>&1 || true
killall quicklookd 2>/dev/null || true

touch "$ROOT/samples/mini.pdb" "$ROOT/samples/mini.cif" 2>/dev/null || true

cat <<REPORT
Installed local copy:
  $DEST

Check extension registration:
  pluginkit -m -p com.apple.quicklook.preview | grep -i Burrete

Forced tests:
  qlmanage -p -c com.local.burrete10.pdb "$ROOT/samples/mini.pdb"
  qlmanage -p -c com.local.burrete10.cif "$ROOT/samples/mini.cif"

Normal tests:
  qlmanage -p "$ROOT/samples/mini.pdb"
  qlmanage -p "$ROOT/samples/mini.cif"
REPORT
