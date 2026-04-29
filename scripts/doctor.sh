#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
echo "== Burrete doctor =="
echo "pwd -P: $ROOT"
echo "package version: $(grep '"version"' package.json | head -1)"
echo "bundle IDs in project:"
grep -n 'PRODUCT_BUNDLE_IDENTIFIER' Burrete.xcodeproj/project.pbxproj || true
echo "force-preview UTI:"
grep -n 'burrete' scripts/force-preview.sh || true
echo "Trash check:"
case "$ROOT" in *"/.Trash/"*|*"/Library/Mobile Documents/.Trash/"*) echo "ERROR: project is inside Trash"; exit 1;; *) echo "OK: not in Trash";; esac
echo "Expected v10 markers:"
grep -Eq '"version": "0\.10\.[0-9]+"' package.json && echo "OK package v10" || { echo "ERROR package is not v10"; exit 1; }
grep -q 'com.local.BurreteV10.Preview' Burrete.xcodeproj/project.pbxproj && echo "OK project v10" || { echo "ERROR project is not v10"; exit 1; }
grep -q 'com.local.burrete10.pdb' scripts/force-preview.sh && echo "OK force-preview v10" || { echo "ERROR force-preview is not v10"; exit 1; }
