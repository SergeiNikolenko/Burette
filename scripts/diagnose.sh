#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
FILE="${1:-$ROOT/samples/mini.pdb}"
if [[ -f "$FILE" ]]; then
  FILE="$(cd -P "$(dirname "$FILE")" && pwd -P)/$(basename "$FILE")"
fi
APP="$HOME/Applications/Burrete.app"
BUILT_APP="$ROOT/build/Burrete.app"
EXT_ID="com.local.BurreteV10.Preview"
CONTAINER_LOG="$HOME/Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete/Burrete.log"
CUSTOM_TYPE="$("$ROOT/scripts/preview-content-type.mjs" "$FILE")"

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
  PLIST="$APP/Contents/PlugIns/BurretePreview.appex/Contents/Info.plist"
elif [ -d "$BUILT_APP" ]; then
  PLIST="$BUILT_APP/Contents/PlugIns/BurretePreview.appex/Contents/Info.plist"
fi
if [ -n "$PLIST" ] && [ -f "$PLIST" ]; then
  /usr/libexec/PlistBuddy -c 'Print :NSExtension:NSExtensionAttributes:QLSupportedContentTypes' "$PLIST" 2>/dev/null || defaults read "$PLIST" NSExtension || true
else
  echo "No embedded extension plist found."
fi

printf '\n== Installed app custom UTI declaration ==\n'
if [[ -n "$CUSTOM_TYPE" && -d "$APP" ]]; then
  /usr/libexec/PlistBuddy -c 'Print :UTExportedTypeDeclarations' "$APP/Contents/Info.plist" 2>/dev/null |
    awk -v target="$CUSTOM_TYPE" '
      BEGIN { capture = 0 }
      /UTTypeIdentifier =/ && index($0, target) { capture = 1 }
      capture { print }
      capture && /^    }$/ { exit }
    ' || true
else
  echo "No matching custom UTI in preview format registry for this file."
fi

printf '\n== System UTI declaration ==\n'
if [[ -n "$CUSTOM_TYPE" ]] && command -v swift >/dev/null 2>&1; then
  CUSTOM_TYPE_VALUE="$CUSTOM_TYPE" /usr/bin/swift -e '
import CoreServices
import Foundation

let identifier = ProcessInfo.processInfo.environment["CUSTOM_TYPE_VALUE"] ?? ""
if identifier.isEmpty {
    print("No custom UTI selected.")
} else {
    let declaration = UTTypeCopyDeclaration(identifier as CFString)?.takeRetainedValue() as NSDictionary?
    print(identifier)
    print(declaration ?? [:])
}
' 2>/dev/null || true
else
  echo "swift unavailable or no custom UTI selected."
fi

printf '\n== pluginkit ==\n'
pluginkit -m -p com.apple.quicklook.preview | grep -i Burrete || echo "Burrete not listed by pluginkit."
pluginkit -m -p com.apple.quicklook.preview -i "$EXT_ID" || true

printf '\n== QuickLook plugin map hints ==\n'
qlmanage -m plugins 2>/dev/null | grep -Ei 'Burrete|pdb|cif|sdf|palm|vesta' || true

printf '\n== Suggested tests ==\n'
if [ -f "$FILE" ]; then
  CONTENT_TYPE="$(mdls -raw -name kMDItemContentType "$FILE" 2>/dev/null || true)"
  if [[ "$CONTENT_TYPE" == *"could not find"* ]]; then
    CONTENT_TYPE=""
  fi
  if [[ -n "$CONTENT_TYPE" && "$CONTENT_TYPE" != "(null)" ]]; then
    echo "qlmanage -p -c '$CONTENT_TYPE' '$FILE'"
  fi
  case "${FILE##*.}" in
    pdb|PDB|ent|ENT|pdbqt|PDBQT|pqr|PQR) echo "./scripts/force-preview.sh '$FILE'" ;;
    csv|CSV|tsv|TSV) echo "qlmanage -p '$FILE'" ;;
    cif|CIF|mmcif|MMCIF|mcif|MCIF|bcif|BCIF|sdf|SDF|sd|SD|mol|MOL|mol2|MOL2|xyz|XYZ|gro|GRO) echo "./scripts/force-preview.sh '$FILE'" ;;
  esac
  echo "qlmanage -d 4 -p '$FILE'"
fi

printf '\n== Last Burrete log ==\n'
for LOG in "$CONTAINER_LOG" "/tmp/Burrete.log" "${TMPDIR:-/tmp}/Burrete.log"; do
  if [ -f "$LOG" ]; then
    echo "-- $LOG --"
    tail -40 "$LOG"
  else
    echo "No log found at $LOG"
  fi
done

printf '\n== Notes ==\n'
echo "If forced preview works but normal Space does not, the issue is LaunchServices/UTI selection, not Mol*."
echo "If the preview errors or stays on a status message, run ./scripts/tail-log.sh and paste the log."
echo "If pluginkit shows nothing, run ./scripts/install-local.sh, then enable Burrete V10 in System Settings → General → Login Items & Extensions → Quick Look."
