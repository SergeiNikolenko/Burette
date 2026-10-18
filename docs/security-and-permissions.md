# Security And Permissions

Burette works with local molecular files, native macOS preview extensions,
browser-dev servers, and agent-operated sessions. The security model is local
first: explicit files, bounded payloads, tokenized browser surfaces, and narrow
native command permissions.

## Local File Access

Desktop Copy actions use the `write_clipboard_text` command to write plain text
to the macOS pasteboard, including actions that finish asynchronously. This
command does not read the clipboard. Browser previews use the Web Clipboard API
with a selection-copy fallback.

- The desktop app opens files selected by the user, command-palette actions,
  drag-and-drop, recent/project roots, or explicit agent-session commands.
- Background project enumeration stays inside project roots explicitly selected
  by the user and does not follow symbolic links. Burette does not enumerate
  Photos, Music, or other home folders unless the user selects that folder as a
  project root.
- Browser-dev filesystem access must be explicit. Use `BURETTE_DEV_FS_ALLOW`
  for extra local roots during browser testing.
- Quick Look receives a file selected by Finder or a forced preview command. It
  should not scan unrelated directories to discover additional data. The one
  exception is a molecular-dynamics coordinate file (`.xtc`, `.trr`, `.dcd`,
  ...): Quick Look lists the file's own folder, without recursion, to find its
  topology (`.pdb`, `.gro`, ...) and reads only that pair.
- Large molecular files should stay path-based unless a runtime explicitly
  needs inline data.

Do not add recursive directory ingestion, broad home-directory reads, or hidden
network fetches without an explicit design and validation plan.

Native directory expansion confines every resolved descendant to the selected
canonical directory, including file and directory symlinks. Internal aliases
retain their displayed paths; an explicitly selected symlink file or directory
still grants its resolved target. Existing traversal limits and cycle detection
remain in effect. Canonical checks do not provide descriptor-level isolation
against a malicious process replacing paths concurrently as the same user.

Quick Look GraphML parsing rejects duplicate effective node IDs, including
collisions with generated IDs, before constructing lookup dictionaries. GraphML
and edge-list star layouts sort leaves once and index them by ID, preserving
node order and coordinates without a per-node linear search through all leaves.

The RDKit grid drawing cache retains at most 2,000 entries and 32 MiB of
UTF-16 key and SVG string payload; individual entries above 2 MiB are not
cached. Molecule and reaction drawings share this budget. Oversized drawings
still reach waiting cards in full. These limits cover retained cache strings,
not transient RDKit computation, visible DOM content, or separate renderer caches.

Updater cleanup is limited to staged `.app` bundles below Burette's current and
legacy `Library/Application Support/.../Updates` directories. It must not scan
or remove applications from the user's home folders, Trash, backups, or
development worktrees.

## Native HTTP Downloads

Native database and remote-structure HTTP downloads bound curl stdout while it
is read, including chunked responses on curl versions that do not enforce
`--max-filesize` for unknown lengths. The existing caller limit is retained
(at most 48 MiB); diagnostics are limited to 64 KiB. Overflow and IO failures
discard partial data, kill the process group and reap the child. Concurrent
stdin/stdout/stderr handling keeps one request deadline effective across DNS,
all redirect hops and blocked pipes. DNS allows at most four active OS lookups
process-wide, without a queue; callers stop waiting at the request deadline.
An OS lookup cannot be cancelled and retains its slot until it actually exits.
Every hop rejects non-public addresses and pins the complete validated answer
(at most 64 addresses) into curl while retaining the original TLS hostname.

The fixed RCSB PDB downloader also supervises curl pipes, retaining its separate
75 MiB stdout limit and 120-second deadline, with at most 64 KiB of diagnostics.
The PDB command accepts a validated four-character ID, not an arbitrary URL.
Browser structure downloads count received bytes during streaming and abort
transport on overflow or timeout: 10 MiB / 30 seconds for arbitrary structure
URLs and 75 MiB / 120 seconds for RCSB PDB. The deadline covers headers and body;
decoded UTF-8 replacement expansion is bounded too. No partial structure is
returned. Browser CORS rules remain applicable; these transport bounds do not
grant the browser native access to local files or private networks.

## Compute Data Root

The native Compute Layer stores its coordinator database, immutable molecular
snapshots, and artifacts below the app-data `compute/` directory. The root is
private to the current user (`0700`), is owned by one Burette process through a
retained exclusive lease, and is revalidated before path-based database access.
The `snapshots/` child is created and reopened relative to the retained root
descriptor. Snapshot directories and files use descriptor-relative operations,
strict whitelists, private modes, canonical identifiers, bounded inventories,
same-file hashing, durable staging, and atomic no-replace publication.

The supported production location is a local Unix filesystem with ordinary
APFS/POSIX directory-link and atomic-rename semantics. A relocated app-data
directory on a filesystem with incompatible metadata semantics must fail closed
rather than weaken snapshot verification.

The lease coordinates Burette processes and protects against accidental path
replacement, stale writers, symlink traversal, and hard-linked snapshot files.
It is not an OS security boundary against an actively malicious process already
running as the same macOS user and deliberately ignoring the advisory lease.
Such a process can race name-based POSIX operations that have no portable
descriptor-only unlink equivalent. Protect that boundary with macOS account and
device security; do not claim resistance to a hostile same-UID process.

## Tauri Permissions

Tauri command access is controlled by:

- `apps/desktop/src-tauri/capabilities/default.json`
- `apps/desktop/src-tauri/permissions/burette.toml`
- `apps/desktop/src-tauri/capabilities/compute.json`
- `apps/desktop/src-tauri/permissions/compute.toml`

The compute pair is a separate capability for the trusted `main` and
`workspace-*` windows: it allowlists the `compute_*` commands (job submission
and cancellation, artifact manifests, purge) without widening the default
shell capability.

When adding a Tauri command:

1. Keep the command narrow and typed.
2. Add it to the Burette permission allowlist only when the desktop shell needs
   it.
3. Keep payloads explicit; avoid unstructured `any`-style JSON at the native
   boundary.
4. Add or update the focused Tauri/frontend bridge test when the command is a
   user-visible or agent-visible contract.

## Preview Extension Entitlements

The Finder Quick Look extension runs sandboxed with the entitlements declared
in `PreviewExtension/BurettePreview.entitlements`:

- `com.apple.security.app-sandbox`
- `com.apple.security.files.user-selected.read-only`
- `com.apple.security.files.user-selected.executable`
- `com.apple.security.network.client`
- `com.apple.security.temporary-exception.files.home-relative-path.read-only`
  (`/`) and `com.apple.security.temporary-exception.files.absolute-path.read-only`
  (`/Volumes/`)

The sandbox only hands the extension the file Finder selected, so the read-only
temporary exceptions exist for the trajectory pair lookup above: without them a
coordinate file previews with no topology and no playback. They cover the home
folder and external volumes only. Keep the extension read-only over user files;
do not add write entitlements, and do not use these exceptions to read beyond
the selected file's folder.

## Browser And Agent Surfaces

Browser means the in-app Browser plugin unless a user explicitly asks for an
external browser. The Browser and Computer surfaces are verification tools, not
the source of molecular truth.

- `scripts/burette-agent.mjs` is the app-control contract.
- `scripts/agent-preview.mjs` is the tokenized preview server.
- Browser shell sessions use explicit session directories with observe/action
  files.
- MCP tools should wrap the CLI or plugin validation scripts instead of
  reimplementing app control.
- Widget snapshots, molecular reports, tables, and trajectory artifacts must be
  bounded before rendering.

Do not add arbitrary shell execution, arbitrary JavaScript execution,
destructive overwrites, or remote job submission to the plugin/MCP surface.

## Local Servers

Local browser-dev or preview servers are for development and QA. Use
[Testing surfaces](tools/testing-surfaces.md) before starting one.

- Bind to local hosts only.
- Prefer generated tokens for preview sessions that expose file content.
- Do not silently fall back from Browser verification to the desktop app; those
  are different surfaces.
- Report localhost bind failures as environment/runtime failures, not app logic
  regressions.

## Release Secrets

Release credentials are secret material:

- Developer ID certificates and passwords
- Apple ID, team ID, and app-specific password
- Notary keychain profile names
- update manifest signing keys
- Homebrew tap token

Store them in the local keychain/environment or GitHub Actions secrets. Never
commit them, print them in logs, or include them in diagnostics bundles.

## Diagnostics And Logs

Diagnostics bundles are local artifacts. They are intended to contain logs,
environment summaries, app size reports, performance marks, recent UI/render
errors, and preview traces. They should not include raw molecule contents,
structure payloads, credentials, or private keys.

Useful local diagnostics commands:

```bash
./scripts/doctor.sh
./scripts/diagnose.sh samples/mini.pdb
./scripts/tail-log.sh
```

When sharing diagnostics, prefer the smallest excerpt that explains the issue.
Redact local usernames, private paths, credentials, and proprietary molecule
data when they are not needed for the fix.

## Security Reporting

Do not put exploit details, credentials, or private sample data into a public
issue or pull request. Coordinate privately with a maintainer and provide a
minimal reproduction that avoids sensitive molecular data where possible.

## Collection editing limits

Eager merge, append and create operations share two edit slots. Merge accepts at
most 64 source paths and 75 MiB total input; all eager collection edits bound
actual input reads and output growth to 75 MiB, with a 256 KiB CSV/TSV header
limit. Rejected append operations preserve the target. Failed merged preview
opening removes only the newly generated source directory. Successful generated
sources remain available for the viewer and Save As. Ordinary large collection
opening and file-backed Save As keep their existing streaming behavior.

MolJ runtime classification validates the complete JSON using bounded nesting
and no heap allocation. It preserves ordinary/Mesoscale routing, escaped keys,
last duplicate values, and the existing malformed-session fallback without
building a second document tree.
