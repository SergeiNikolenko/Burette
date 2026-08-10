#!/usr/bin/env bash
set -euo pipefail

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun is unavailable. Install full Xcode and select its developer directory." >&2
  exit 1
fi

if metal_output="$(xcrun metal -v 2>&1)"; then
  exit 0
fi

if [[ "$metal_output" == *"missing Metal Toolchain"* ]]; then
  component_state=""
  if command -v xcodebuild >/dev/null 2>&1; then
    component_state="$(xcodebuild -showComponent MetalToolchain 2>/dev/null || true)"
  fi
  if [[ "$component_state" == *"Status: installed"* ]]; then
    echo "error: Xcode's MetalToolchain is installed, but xcrun's lookup cache is stale." >&2
    echo "Run: xcrun --kill-cache" >&2
  else
    echo "error: Xcode's MetalToolchain component is not installed." >&2
    echo "Run: xcodebuild -downloadComponent MetalToolchain" >&2
  fi
else
  echo "error: xcrun cannot execute the Metal compiler:" >&2
  printf '%s\n' "$metal_output" >&2
fi
exit 1
