# Slow Storage Resilience Spec

## Summary

Make workspace open and sidebar operations resilient to storage whose I/O latency is unpredictable — cloud-synced folders (iCloud Drive, Dropbox Smart Sync, OneDrive Files On-Demand, Google Drive Stream), network mounts (SMB / NFS), external drives, and any other filesystem where opening or reading a file may block on network, materialization, or a slow medium.

Today `read_directory_impl` (`apps/desktop/src-tauri/src/commands/fs.rs:174`) calls `extract_title` synchronously for every `.md` entry, which opens the file and reads 4 KB. On a local SSD that is ~100 µs per file. On an iCloud-placeholder `.md`, the `open`/`read` can block seconds or minutes waiting for the cloud daemon to materialize the file; on a stalled network mount, it can block indefinitely. The IPC worker running `read_directory` blocks for the entire directory, the sidebar blocks on its `await`, and the workspace feels broken whenever it happens to sit on slow storage.

The workspace-switch hang fix addressed the secondary effect — a slow `read_directory` no longer holds the `workspace_ignore` lock and stalls the _next_ switch. This spec fixes the primary effect: `read_directory` itself should never block on slow per-file I/O in the first place.

## Goals

- Sidebar folder listings paint with the same latency regardless of where the workspace lives. Titles fill in asynchronously as they become available.
- A single pathologically-slow file (iCloud placeholder waiting on an offline device, network mount hiccup) cannot block the sidebar or any IPC.
- The mechanism is storage-agnostic: no hardcoded list of "cloud" providers, no platform-specific APIs in the hot path. Any filesystem with slow I/O benefits automatically.
- Titles eventually populate — not silently discarded — without spinning a scan or user interaction.

## Non-Goals

- **User-visible cloud integration.** No "Downloading from iCloud…" badge, no "Open in Finder" affordance. Titles just appear when they're ready.
- **Forcing materialization.** If an iCloud file is cloud-only and the user never opens it, we do not pay any download bandwidth to extract its title. The entry appears by filename in the sidebar.
- **Provider-specific path lists.** No `~/Library/Mobile Documents/…` or `~/Dropbox/…` hardcoding. Heuristics like that are brittle — they miss new providers, break when vendors rename paths, and don't cover network mounts or external disks at all.
- **A persistent title cache across restarts.** That's a separate optimization (see `SPECs/workspace-snapshot-spec.md` for a disk-backed snapshot as a follow-up).
- **Timeout-based cancellation of the OS syscall itself.** A `read()` blocked in the kernel cannot be cancelled from user space without killing the thread. This spec relies on _off-the-hot-path_ placement, not cancellation.

## Approach

Two cooperating changes, both storage-agnostic.

### 1. Move title extraction off the synchronous `read_directory` path

`read_directory_impl` stops calling `extract_title`. It returns `DirEntry { title: None, … }` for every markdown file and returns immediately. Sidebar paints with filenames.

A new IPC command — `extract_titles(paths: Vec<String>) -> Vec<(String, Option<String>)>` — takes a batch of paths and returns their titles. The frontend calls it _after_ `read_directory` resolves and the sidebar has rendered. Titles stream in; the sidebar rows re-render in place as each resolves. Because extraction runs entirely on a background thread via `spawn_blocking`, a slow file blocks only that single extraction request, never the IPC thread or the sidebar.

Two implementation notes:

- **Batched, not per-file.** One IPC per folder-worth of files (tens, rarely hundreds), not one IPC per file. The batch command internally processes files in parallel on a bounded thread pool (say 4) so one slow file doesn't serialize the others.
- **Cancellable by epoch.** The batch command captures `workspace_epoch` at start and bails if it moves. Switching folders abandons pending title extraction for the previous folder.

### 2. Bound each extraction with a wall-clock deadline

Within `extract_title`, wrap the `File::open` + `read` in a worker thread with a generous timeout (e.g. 2 seconds). If the timeout fires, return `None` and log at `warn` level with the path. The worker thread is orphaned — we cannot kill it — but it's off the user's critical path and the title stays `None` for the current session.

This is a backstop, not the primary mechanism. The primary mechanism (offloading to async) already prevents blocking the sidebar. The timeout prevents a single request from piling up background threads indefinitely if the user triggers many title extractions against slow storage in succession.

```rust
fn extract_title(path: &Path) -> Option<String> {
    let path = path.to_path_buf();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(extract_title_blocking(&path));
    });
    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(title) => title,
        Err(_) => {
            eprintln!("extract_title: timed out for {:?}", path);
            None
        }
    }
}
```

The thread+channel overhead is ~10 µs, dwarfed by the 4 KB read itself on any real storage. No path heuristics, no platform API, just "if this takes >2 s something is wrong."

### Interaction with the workspace snapshot spec

`SPECs/workspace-snapshot-spec.md` proposes moving title extraction into the initial walker so sidebar expansion pays zero file opens. That spec's cost model assumes SSD-local extraction times; on slow storage the walker itself would stall.

This spec's mechanisms apply to the walker too. The walker should:

- Use the same bounded-timeout `extract_title`, so a single slow file doesn't block a walker thread for more than 2 s.
- Optionally, defer title extraction _entirely_ during the initial walk and fill titles in via the same `extract_titles` async path after the snapshot is built. That decouples snapshot-ready from titles-ready and keeps `index:complete` fast on any storage.

The specs compose: snapshot gives you the structure fast; this spec gives you titles lazily, bounded.

## Files Expected To Change

- `apps/desktop/src-tauri/src/commands/fs.rs` — `read_directory_impl` no longer calls `extract_title`; titles in the returned `DirEntry` are always `None`. Add a new `extract_titles` command (batched, epoch-guarded, parallel-bounded). Wrap `extract_title` in the timeout helper.
- `apps/desktop/src/types/fs.ts` — no shape change; `title` stays `Option<String> | null`.
- `apps/desktop/src/components/sidebar/file-tree.tsx` (or a companion hook) — after a folder's entries arrive, call `extract_titles` for the markdown paths and merge the resulting titles into the displayed rows. Handle the case where the user collapses the folder before titles arrive (cancel/ignore).
- `apps/desktop/src/stores/workspace-store.ts` — small helper to merge resolved titles into `directoryCache` without tearing down subtrees.
- Rust unit tests: a synthetic "slow file" (blocking pipe or sleep in a fake FS) times out after ~2 s and returns `None` instead of hanging.

## Acceptance Criteria

- Opening a workspace on an iCloud-synced folder with cloud-only `.md` placeholders renders the sidebar in under 200 ms (filename-only) and populates titles within a few seconds as files are materialized in the background. No IPC blocks >200 ms.
- Opening a workspace on a responsive SSD has no visible regression: titles appear either before the first paint (if the async extraction finishes in <16 ms, very common) or within the next render, with no flicker.
- Disconnecting the network while a title extraction is in progress does not hang the app. Affected titles stay `None` for the session; the sidebar remains responsive; subsequent folder expansions in the same workspace behave normally.
- Switching workspaces while title extraction for the prior workspace is in flight abandons the pending extraction (epoch mismatch); no stale title appears in the new workspace.
- A stress test that points the sidebar at a folder of 1000 files where 10 % block for 10+ seconds completes the visible render immediately, produces titles for the fast 90 % within a second, and leaves the slow 10 % as `None` after the timeout — with no thread leak measurable in Activity Monitor after 5 minutes.
