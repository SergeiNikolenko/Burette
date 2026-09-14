#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:?release version}"
REPO=SergeiNikolenko/Burette
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# A missing asset is recoverable; a failed download of a listed asset is not
# permission to discard feed history. Keep a backup before replacing the live asset.
EXISTS=0
if gh release view update-feed --repo "$REPO" --json assets > "$WORK/release.json"; then
  EXISTS=1
  ASSET="$(python3 - "$WORK/release.json" <<'PY'
import json, sys
names = {asset['name'] for asset in json.load(open(sys.argv[1]))['assets']}
print(next((name for name in ('appcast.xml', 'appcast.previous.xml') if name in names), ''))
PY
)"
  if [[ -n "$ASSET" ]]; then
    gh release download update-feed --repo "$REPO" --pattern "$ASSET" --dir "$WORK"
    cp "$WORK/$ASSET" "$WORK/previous.xml"
  fi
fi
ARGS=("$ROOT/Burette-$VERSION.zip" "$ROOT/build/Burette.app" "$WORK/next.xml")
[[ ! -f "$WORK/previous.xml" ]] || ARGS+=("$WORK/previous.xml")
python3 "$ROOT/scripts/sparkle-appcast.py" "${ARGS[@]}"
if [[ "$EXISTS" == "0" ]]; then
  # If the read failed for another reason, create fails on the existing tag;
  # never fall through to clobbering it. Generate before creating an empty feed.
  gh release create update-feed --repo "$REPO" --prerelease --latest=false \
    --title 'Burette update feed' --notes 'Metadata for automatic updates. Download the app from a versioned release.'
fi
if [[ "${ASSET:-}" == "appcast.xml" ]]; then
  cp "$WORK/previous.xml" "$WORK/appcast.previous.xml"
  gh release upload update-feed "$WORK/appcast.previous.xml" --repo "$REPO" --clobber
fi
mv "$WORK/next.xml" "$WORK/appcast.xml"
gh release upload update-feed "$WORK/appcast.xml" --repo "$REPO" --clobber
