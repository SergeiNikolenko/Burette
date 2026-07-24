#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
echo "== Burette doctor =="
echo "pwd -P: $ROOT"
echo "package version: $(grep '"version"' package.json | head -1)"
echo "bundle IDs in project:"
grep -n 'PRODUCT_BUNDLE_IDENTIFIER' Burette.xcodeproj/project.pbxproj || true
echo "force-preview UTI:"
grep -n 'burette' scripts/force-preview.sh || true
grep -n 'burette' scripts/preview-content-type.mjs || true
echo "Trash check:"
case "$ROOT" in *"/.Trash/"*|*"/Library/Mobile Documents/.Trash/"*) echo "ERROR: project is inside Trash"; exit 1;; *) echo "OK: not in Trash";; esac
echo "Expected v1 markers:"
grep -Eq '"version": "1\.0\.[0-9]+"' package.json && echo "OK package v1" || { echo "ERROR package is not v1"; exit 1; }
grep -q 'com.local.BuretteV10.Preview' Burette.xcodeproj/project.pbxproj && echo "OK project v10" || { echo "ERROR project is not v10"; exit 1; }
grep -q 'preview-content-type.mjs' scripts/force-preview.sh && grep -q 'com.local.burette10.pdb' config/preview-formats.json && echo "OK force-preview v10" || { echo "ERROR force-preview is not v10"; exit 1; }
