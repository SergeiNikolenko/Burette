#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FILE="${1:-$ROOT/samples/mini.pdb}"
APP="$HOME/Applications/MolstarQuickLook.app"
BUILT_APP="$ROOT/build/Build/Products/Debug/MolstarQuickLook.app"
EXT_ID="com.local.MolstarQuickLookV10.Preview"

printf '\n== File ==\n%s\n' "$FILE"
if [ -f "$FILE" ]; then
  ls -l "$FILE" || true
else
  echo "File does not exist."
fi

printf '\n== mdls content type ==\n'
if command -v mdls >/dev/null 2>&1 && [ -f "$FILE" ]; then
  mdls -name kMDItemContentType -name kMDItemContentTypeTree -name kMDItemKind "$FILE" || true
else
  echo "mdls unavailable or file missing."
fi

printf '\n== Installed app ==\n'
if [ -d "$APP" ]; then
  echo "$APP"
else
  echo "Not installed at $APP"
fi
if [ -d "$BUILT_APP" ]; then
  echo "Build output exists: $BUILT_APP"
fi

printf '\n== Embedded extension plist supported types ==\n'
PLIST=""
if [ -d "$APP" ]; then
  PLIST="$APP/Contents/PlugIns/MolstarQuickLookPreview.appex/Contents/Info.plist"
elif [ -d "$BUILT_APP" ]; then
  PLIST="$BUILT_APP/Contents/PlugIns/MolstarQuickLookPreview.appex/Contents/Info.plist"
fi
if [ -n "$PLIST" ] && [ -f "$PLIST" ]; then
  /usr/libexec/PlistBuddy -c 'Print :NSExtension:NSExtensionAttributes:QLSupportedContentTypes' "$PLIST" 2>/dev/null || defaults read "$PLIST" NSExtension || true
else
  echo "No embedded extension plist found."
fi

printf '\n== pluginkit ==\n'
pluginkit -m -p com.apple.quicklook.preview | grep -i Molstar || echo "MolstarQuickLook not listed by pluginkit."
pluginkit -m -p com.apple.quicklook.preview -i "$EXT_ID" || true

printf '\n== QuickLook plugin map hints ==\n'
qlmanage -m plugins 2>/dev/null | grep -Ei 'Molstar|pdb|cif|sdf|palm|vesta' || true

printf '\n== Suggested tests ==\n'
if [ -f "$FILE" ]; then
  CONTENT_TYPE="$(mdls -raw -name kMDItemContentType "$FILE" 2>/dev/null || true)"
  if [[ -n "$CONTENT_TYPE" && "$CONTENT_TYPE" != "(null)" ]]; then
    echo "qlmanage -p -c '$CONTENT_TYPE' '$FILE'"
  fi
  case "${FILE##*.}" in
    pdb|PDB|ent|ENT|pdbqt|PDBQT|pqr|PQR) echo "./scripts/force-preview.sh '$FILE'" ;;
    cif|CIF|mmcif|MMCIF|mcif|MCIF|bcif|BCIF|sdf|SDF|sd|SD|mol|MOL|mol2|MOL2|xyz|XYZ|gro|GRO) echo "./scripts/force-preview.sh '$FILE'" ;;
  esac
  echo "qlmanage -d 4 -p '$FILE'"
fi

printf '\n== Last MolstarQuickLook log ==\n'
for LOG in "/tmp/MolstarQuickLook.log" "${TMPDIR:-/tmp}/MolstarQuickLook.log"; do
  if [ -f "$LOG" ]; then
    echo "-- $LOG --"
    tail -80 "$LOG"
  else
    echo "No log found at $LOG"
  fi
done

printf '\n== Notes ==\n'
echo "If forced preview works but normal Space does not, the issue is LaunchServices/UTI selection, not Mol*."
echo "If the preview errors or stays on a status message, run ./scripts/tail-log.sh and paste the log."
echo "If pluginkit shows nothing, run ./scripts/install-local.sh, then enable Molstar Quick Look V10 in System Settings → General → Login Items & Extensions → Quick Look."
