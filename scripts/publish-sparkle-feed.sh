#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:?release version}"
REPO=SergeiNikolenko/Burette
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Serialize release jobs: each update must retain the previous stable/beta entries.
if gh release view update-feed --repo "$REPO" >/dev/null 2>&1; then
  gh release download update-feed --repo "$REPO" --pattern appcast.xml --dir "$WORK"
else
  # A failed read must not be mistaken for permission to overwrite an existing feed.
  gh release create update-feed --repo "$REPO" --prerelease --latest=false \
    --title 'Burette update feed' --notes 'Metadata for automatic updates. Download the app from a versioned release.'
fi
PREVIOUS=()
[[ ! -f "$WORK/appcast.xml" ]] || PREVIOUS=("$WORK/appcast.xml")
python3 "$ROOT/scripts/sparkle-appcast.py" "$ROOT/Burette-$VERSION.zip" \
  "$ROOT/build/Burette.app" "$WORK/next.xml" "${PREVIOUS[@]}"
mv "$WORK/next.xml" "$WORK/appcast.xml"
gh release upload update-feed "$WORK/appcast.xml" --repo "$REPO" --clobber
