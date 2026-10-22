# Local plugin recovery audit — 2026-09-21

## Confirmed preserved

- Hosted worktree: `/Users/nikolenko/Documents/Projects/Burette-plugin-current-main`,
  branch `fix/plugin-current-main`, commit `628150e5a` (also on origin).
- Hosted widget, Ketcher continuation/CAS, recording guide and submission checklist
  remain in that worktree. This is not the local native-card implementation.
- Original task history records installation of `0.2.2+local.20260913.6` on
  September 13, including matching hashes for the manifest, local-viewer HTML,
  native-workspace HTML and native-workspace asset manifest.
- Remote `/home/nikolenko/work/Projects/Burette-local-plugin-check` on Gauss
  preserves an earlier local implementation at `e624814579b6317c57d77a7e2366636932551bc1`
  plus working changes. It is not established as the September 13 version.

## Missing from checked locations

- Former local worktree `/Users/nikolenko/Documents/Projects/Burette-local-plugin-fix`.
- Installed cache `0.2.2+local.20260913.6`; current cache contains only `0.2.2`.
- Native-workspace HTML in searched local project/cache and remote build locations.
- Recorded remote builds `/tmp/burette-widget.ONCh57`, `/tmp/burette-controls.m1Xsit`,
  and `/home/nikolenko/work/Projects/burette-widget-build.BVimQ6`.

Absence here does not prove permanent loss. The task history includes source
patches, but they have not been reconstructed into a complete validated package.

## Requirements that must survive recovery

- Open the real in-chat/native-pane MCP App, not a Browser substitute.
- Remove the manual card resize control; hide bottom-dock UI in inline mode.
- Retain widget-wrapper Apps SDK UI controls and light/dark styling without
  redesigning internal Mol*/Ketcher interfaces.
- Prevent bottom-right host menu and molecular tooltip overlap.
- Preserve tab scenes on switching and maintain requested drag interactions.
- Preserve strict CSP/JIT-free bootstrap and molecular state validation.
- Demonstrate English, one-command, no-file-attachment public-PDB/Ketcher flow.

The first six require local source recovery and runtime verification; historical
test results are not fresh acceptance. Hosted server checks do not prove these.

## Installation gate

No installation or cache replacement was performed during this audit. Installing
the available generic package again would not restore the requested native card.
Recover source patches against the earlier local implementation, regenerate the
bundle, run focused transport/UI tests, and install using the documented local
marketplace flow. A fresh task/restart is required to verify the updated toolset.
