# Workspace Snapshot Spec

> **Follow-up to the workspace-switch hang fix.** The hang fix shipped; this spec is the architectural cleanup that builds on the epoch / cancellation primitives it introduced. Do not start until the hang fix has been in the wild for a release or two.

## Summary

Replace the current `Vec<IndexedFile>` + `HashSet<PathBuf>` pair with a richer, incrementally-maintained in-memory snapshot of the workspace, modeled on Zed's worktree. Today Writer stores only `{ path, relative_path, name }` per markdown file and recomputes titles (via `extract_title` in `apps/desktop/src-tauri/src/commands/fs.rs:43`) every time the sidebar expands a folder. This forces a full `read_directory` + N × 4 KB file reads on every expansion and leaves the watcher as a pure "notify the frontend" layer rather than a source of truth.

A single snapshot keyed by path **and** inode, maintained incrementally by the watcher, lets the sidebar, fuzzy search, tags, and future features read from the same consistent view without re-opening files.

Reference: Zed's `crates/worktree/src/worktree.rs` (`Entry` struct at line 3547, `entries_by_path` / `entries_by_id` at 179-180). We adopt the _shape_ of their design, not their `SumTree` storage — Writer's workspaces are small enough that a BTreeMap is enough.

## Goals

- One canonical in-memory snapshot of the workspace's markdown entries, with enough metadata to serve the sidebar, command palette, and future tags/date features without re-reading files.
- Entries are keyed by both path and a stable entry ID (inode on macOS/Linux) so renames update existing rows instead of destroying and recreating them.
- The watcher applies incremental updates directly to the snapshot (add / remove / rename / mtime-changed), then emits a coalesced `snapshot:changed` event. The UI reads from the snapshot, never from disk for metadata.
- Titles live on the entry and are recomputed only when mtime changes, not on every folder expansion.
- `read_directory` returns a view _of the snapshot_, not a fresh disk walk.

## Non-Goals

- **Full-text / grep search** — content never enters the snapshot. Text search lands as its own spec (`SPECs/fuzzy-search-grep-spec.md`).
- **Workspace switch cancellation / epoch semantics** — shipped with the workspace-switch hang fix. This spec assumes those primitives already exist in `AppState` and just hooks into them.
- Adopting Zed's `SumTree`. `BTreeMap<PathBuf, Entry>` + `HashMap<EntryId, PathBuf>` is sufficient at Writer's scale. Keep the door open: all lookups go through a `Snapshot` abstraction so the backing store can be swapped later if needed.
- Multi-reader / collaboration-grade snapshot semantics. A single `parking_lot::RwLock<Arc<Snapshot>>` is enough.
- Lazy subdirectory expansion (Zed's `UnloadedDir` / `PendingDir`). Writer already walks the whole tree upfront cheaply.
- Per-entry `CharBag` pre-filtering for fuzzy search. Nucleo already performs well at current workspace sizes.
- Persisting the snapshot to disk across restarts (Sublime-style warm start). Revisit if users with >20k-file vaults hit cold-start pain.

## Approach

### Entry shape

Replace `IndexedFile` with:

```rust
pub struct Entry {
    pub id: EntryId,          // stable across renames (inode on unix)
    pub path: Arc<Path>,      // absolute
    pub relative_path: Arc<str>,
    pub name: Arc<str>,
    pub kind: EntryKind,      // File | Dir
    pub mtime: SystemTime,
    pub size: u64,
    pub is_markdown: bool,
    pub title: Option<Arc<str>>,  // extracted once, refreshed on mtime change
    pub is_ignored: bool,          // from WorkspaceIgnore
}
```

Directories are stored too — the sidebar's "does this folder contain markdown?" question becomes a snapshot query, not a separate `HashSet<PathBuf>`.

**Caveat on inode identity.** Some editors save atomically (write to `.tmp`, rename over). That produces a new inode at the same path. The watcher code must treat "new inode appearing at an existing tracked path within a short window" as an update-in-place and carry the old entry's title forward, rather than a rename. Without this, atomic-save workflows lose title stability on every save.

### Storage

```rust
pub struct Snapshot {
    root: PathBuf,
    entries_by_path: BTreeMap<Arc<Path>, Entry>,
    entries_by_id:   HashMap<EntryId, Arc<Path>>,
    version: u64,    // monotonic; bumped on every mutation
}
```

`BTreeMap` gives us ordered iteration for sidebar listings and prefix scans for "entries under directory X". (It does _not_ speed up fuzzy search; that remains O(n) iteration through Nucleo. This spec is about sidebar coherence and rename safety, not search throughput.)

`AppState` holds `RwLock<Arc<Snapshot>>`. Mutations clone-on-write a new `Arc` so long-running reads don't block writers. The version counter lets the frontend skip redundant re-renders.

### Initial scan

`index_workspace_impl` becomes `build_snapshot`. The parallel `ignore::WalkBuilder` walk stays, but now:

- Collects directories as well as markdown files.
- Calls `extract_title` inside the walker for `.md` files, so titles are populated up front instead of during `read_directory`.
- Populates `mtime` / `size` from the `DirEntry` metadata already in hand (no extra `stat`).
- Builds a complete `Snapshot` on a background thread, then swaps it into `AppState` atomically.
- Continues to honor the `Arc<AtomicBool>` cancel flag and `workspace_epoch` added by the hang-fix spec.

Cost model: the walker is already doing `stat`; adding one 4 KB read per `.md` file moves work we were doing per-expansion to once-per-workspace-open. On a 10k-file vault, parallel title extraction adds ~150–300 ms to the background index — invisible to the user.

### Startup ordering: ignore-correctness before titles

The background thread must preserve today's **two-phase** startup so title extraction cost never delays ignore-correctness in the sidebar:

1. **Phase 1 — load the full `WorkspaceIgnore`** (already happens at `apps/desktop/src-tauri/src/commands/workspace.rs:86-94`). Swap it in and emit `fs:directory-changed` so the sidebar re-reads with the real rules. Sidebar becomes correct in ~tens of ms regardless of vault size.
2. **Phase 2 — walk the tree, extract titles, build the snapshot.** Swap the snapshot in and emit `snapshot:changed` (and legacy `index:complete`). Titles fill in when this completes.

Do **not** fold title extraction into Phase 1 — a 50k-file vault would push Phase 1 from tens of ms into the second range, regressing sidebar responsiveness.

An interim render state is acceptable: once the `WorkspaceIgnore` is live but before the snapshot swap, `read_directory` falls back to disk (as today) and the sidebar shows filenames without titles. Each entry must transition to its snapshot-backed row monotonically (no flicker).

### Watcher-driven updates

`watcher.rs` today emits `fs:directory-changed` / `fs:file-changed` events and relies on the UI to re-fetch. After this change, the watcher:

1. Translates FS events into `SnapshotMutation` values (`Add`, `Remove`, `Update`, `Rename`).
2. For `Update`, re-reads mtime/size and re-extracts the title if mtime changed; reuses the old title otherwise.
3. For `Rename`, looks the entry up by `entry_id` so the row survives the rename with its title intact. Atomic-save detection (see "Caveat on inode identity") folds a same-path inode swap into an `Update`.
4. Applies the mutation to a new `Arc<Snapshot>` and swaps it in under the epoch guard from the hang-fix spec.
5. Emits one coalesced `snapshot:changed` event with the new `version`.

Self-write suppression (the existing `recent_writes` map) still applies — the mutation is computed but the event emission can be skipped when the write originated from Writer itself.

### Frontend

The UI subscribes to `snapshot:changed` and calls a new `get_snapshot_slice(path)` IPC (or reuses `read_directory`, re-implemented on top of the snapshot) to get the children of a directory. Because titles already live on the snapshot, the sidebar no longer pays a per-folder title-extraction cost.

Fuzzy search reads from `snapshot.entries_by_path` and filters to `is_markdown && !is_ignored`; shape is otherwise unchanged.

## Rollout

Realistic plan (bundled phases, because the shim-then-delete pattern tends to leave the tree in a weird in-between):

1. **Phase A — introduce types.** Land `Entry`, `Snapshot`, `SnapshotMutation`, and `build_snapshot` alongside the existing `IndexedFile`. Nothing uses them yet. Gates: `cargo test`, `cargo clippy`.
2. **Phase B — migrate reads and watcher together.** Port `fuzzy_search`, `read_directory`, and `dir_contains_markdown` to read from `Snapshot`, and move watcher mutations into `SnapshotMutation` in the same PR. Delete `IndexedFile` and `dirs_with_markdown`. Frontend event names (`fs:directory-changed`, `fs:file-changed`) stay the same for this phase.
3. **Phase C — introduce `snapshot:changed` on the frontend.** Coalesced event replaces the per-file / per-directory fan-out. Sidebar and command palette read through a single event. The old event names are kept as no-op forwards for one release, then removed.

Each phase is independently shippable and revertable.

## Files Expected To Change

- `apps/desktop/src-tauri/src/state.rs` — new `Entry`, `Snapshot`, `SnapshotMutation`; drop `IndexedFile`, `dirs_with_markdown`.
- `apps/desktop/src-tauri/src/commands/search.rs` — `build_snapshot` replaces `index_workspace_impl`; fuzzy search reads from snapshot.
- `apps/desktop/src-tauri/src/commands/fs.rs` — `read_directory_impl` becomes a snapshot query; `extract_title` moves into the initial walker.
- `apps/desktop/src-tauri/src/watcher.rs` — translate FS events to `SnapshotMutation`s; atomic-save inode swap detection.
- `apps/desktop/src-tauri/src/commands/workspace.rs` — build and install the snapshot during `prepare_workspace_state`.
- new `apps/desktop/src-tauri/src/snapshot.rs` — `Snapshot`, `SnapshotMutation`, tests.
- `apps/desktop/src/types/fs.ts` — add `version` field to directory reads if surfaced.
- `apps/desktop/src/hooks/*` and sidebar components — subscribe to `snapshot:changed` (phase C).

## Acceptance Criteria

- Opening a workspace populates the snapshot in one pass; `index:complete` fires once.
- Sidebar folder expansion does zero file opens for markdown titles after the initial scan.
- The full `WorkspaceIgnore` is live and `fs:directory-changed` has been emitted _before_ the snapshot walk starts, so sidebar ignore-correctness is never gated on title extraction. Verifiable via an integration test that opens a workspace with a custom `.gitignore` and 1k+ markdown files and asserts the ignored folder disappears from the sidebar before `snapshot:changed` fires.
- Renaming a `.md` file on disk updates its entry in place (same `entry_id`, new path); title is preserved if content is unchanged.
- Editing a `.md` file (including via atomic write-to-temp-then-rename) updates the snapshot's `mtime` and re-extracts the title if it changed, without losing the row.
- Creating/deleting files produces `Add`/`Remove` mutations and a single coalesced `snapshot:changed` event per debounce window.
- Fuzzy search results match today's output for the same workspace (regression bar).
- No memory regression on a 10k-file workspace; Activity Monitor delta is within noise of today's footprint plus `size_of::<Entry>() * file_count`.
- `cargo test` covers: initial scan correctness, mutation application, rename-by-inode, title preservation on rename, atomic-save inode swap is treated as update, ignored-entry filtering.
