#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TREE="${1:?usage: prepare-sparkle.sh build-tree}"
SDK="$ROOT/build/sparkle/2.9.6"
mkdir -p "$SDK"
ARCHIVE="$SDK/Sparkle-2.9.6.tar.xz"
if [[ ! -f "$ARCHIVE" ]]; then
  curl --fail --location --proto '=https' --proto-redir '=https' \
    https://github.com/sparkle-project/Sparkle/releases/download/2.9.6/Sparkle-2.9.6.tar.xz \
    --output "$ARCHIVE.download"
  mv "$ARCHIVE.download" "$ARCHIVE"
fi
echo "52bf9e88cdd972fc0c81501377a880e90d47031bd8ca5462488f843e2609e192  $ARCHIVE" | shasum -a 256 -c - >&2
# Always extract the verified archive; never trust a previously modified framework.
tar -xf "$ARCHIVE" -C "$SDK"
python3 - "$TREE" "$SDK" <<'PY'
import base64, json, os, pathlib, plistlib, sys
tree, sdk = map(pathlib.Path, sys.argv[1:])
key = os.environ['BURETTE_SPARKLE_PUBLIC_KEY']
if len(base64.b64decode(key, validate=True)) != 32:
    raise ValueError('Sparkle public key must contain 32 bytes')
crate = tree / 'apps/desktop/src-tauri'
config_path = crate / 'tauri.conf.json'
config = json.loads(config_path.read_text())
config['build']['features'] = list(dict.fromkeys([*config['build'].get('features', []), 'sparkle-updater']))
config['bundle']['macOS']['frameworks'] = [str(sdk / 'Sparkle.framework')]
config['bundle']['resources'][str(sdk / 'LICENSE')] = 'licenses/Sparkle.txt'
config_path.write_text(json.dumps(config, indent=2) + '\n')
plist_path = crate / 'Info.plist'
with plist_path.open('rb') as stream:
    info = plistlib.load(stream)
info.update(SUFeedURL='https://github.com/SergeiNikolenko/Burette/releases/download/update-feed/appcast.xml',
            SUPublicEDKey=key, SUEnableAutomaticChecks=False, SUAutomaticallyUpdate=False,
            SUScheduledCheckInterval=43200)
with plist_path.open('wb') as stream:
    plistlib.dump(info, stream)
PY
printf '%s\n' "$SDK"
