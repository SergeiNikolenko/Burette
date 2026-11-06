#!/usr/bin/env bash
# Installs the Debian/Ubuntu packages scripts/build-linux.sh needs: the
# WebKitGTK 4.1 stack Tauri links against, plus the bundlers' tools.
set -euo pipefail

packages=(
  build-essential curl file pkg-config rsync unzip
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libssl-dev libxdo-dev
  patchelf rpm squashfs-tools desktop-file-utils
)
sudo=()
[[ "$(id -u)" == 0 ]] || sudo=(sudo)
"${sudo[@]}" apt-get update
"${sudo[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
