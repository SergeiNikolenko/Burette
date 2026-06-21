---
name: burrete-review-path-contracts
description: Review path, URL, file, and session-directory handling across Burrete boundaries.
---

# Path Contract Review

Use this skill when defining or changing path-bearing types, JSON payloads,
URLs, session files, filesystem allow-lists, or file-open behavior.

## Boundaries

- Tauri commands and Rust helpers use native paths internally.
- Browser-dev routes use URL-encoded query parameters and must not infer access
  outside the allowed filesystem roots.
- Quick Look receives native file URLs and content type metadata from macOS.
- Agent CLI and MCP tool arguments are model-generated and should be parsed as
  explicit strings with feature-specific validation.
- Session directories are local implementation details and must not become user
  API.
- Reports and PR bodies should avoid absolute local paths unless they are needed
  for same-machine debugging.

## Rules

- Validate path traversal, absolute path, relative path, symlink, and missing
  file behavior at the boundary that accepts the path.
- Preserve model-visible path text when possible; normalize only for internal
  execution.
- Fail closed for security-relevant filesystem access.
- Fail open only for UI diagnostics where a missing path should become a clear
  warning instead of a crash.
- Keep `BURRETE_DEV_FS_ALLOW` explicit for browser-dev access outside the repo.
- Do not persist temporary localhost URLs, session directories, or worktree-local
  absolute paths as durable project state.

## Output

Return path issues with the input source, normalized/internal representation,
consumer, and validation gap.
