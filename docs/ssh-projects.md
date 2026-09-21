# SSH structure projects

Use **Projects → + → Create project**. Choose a remote machine in Source folders,
then Add to browse and choose a remote folder. Add remote opens a separate SSH
connection picker, with a manual hostname option. The sidebar lists directories on demand; selecting a file downloads
a preview copy and opens the existing Burette viewer. Settings → Connections
stores named SSH connections separately from projects. One host can supply
multiple project folders; connections can be disabled, checked or removed. Removing a project never deletes server files.

The remote host needs Python 3. System OpenSSH handles keys, SSH agent,
configuration and ProxyJump. Authentication must already work noninteractively,
and the host must already be trusted in known_hosts. Burette does not enroll host
keys, save passwords, install remote software or modify SSH configuration.
Host suggestions currently include literal aliases in the main config file;
aliases defined by Include can also be entered manually.

Projects → … controls grouping by project/section, by connection, or in one flat
list of projects. Sort by priority (pinned first), last opened, or saved manual
order. Remote project menus support pinning, editing, sections, and connection
colors. The hover card shows the full path and last observed connection status.

## Data and limits

- Edits to a downloaded preview affect only its local copy. Folder menus also
  offer Delete folder from server, with the full path and a typed-name confirmation.
  Deletion requires Python 3.11+ with descriptor-relative, symlink-safe rmtree; the
  project root cannot be deleted. Deletion stops on the server after 35 seconds;
  errors may leave a partially deleted folder. Refresh before retrying.
  Removing a project from Burette never invokes deletion. Remote edit writeback is not implemented.
- Folder listings scan at most 2,000 entries per request. The tree initially
  renders 100 entries per folder, with Show more for the rest. Up to 128 listings
  are retained for 30 seconds; Refresh bypasses that cache. Chemistry discovery walks a bounded subtree and expands paths to supported
  chemical files. Hosts are checked once when their projects mount; there is no
  periodic background polling.
- Preview downloads are limited to 64 MiB with a 45-second operation timeout.
  One native SSH request or two browser-server requests run at a time.
  Errors leave saved projects intact.
- Canonical project roots and descriptor-relative, no-follow path traversal keep
  directory navigation within the chosen root. Symlinks are omitted.
- Preview copies live in the app's private cache, capped at 256 downloads / 512 MiB.
  Clear them explicitly through Settings → Maintenance → Preview cache. Cached
  copies are excluded from automatic local project and recent-file discovery.
- Every open reads the remote file again, checking size and modification time
  before and after download. Compound datasets with remote sidecar files are not
  automatically staged; choose self-contained structure files.

## Runtime boundaries

The SSH transport is native Tauri code in `commands/ssh`. Paths travel as JSON on
stdin to a bundled Python file worker, never interpolated into shell code.
The frontend uses typed commands: `ssh_hosts`, `ssh_list`, `ssh_preview`, and `ssh_delete_folder`.
The local browser-dev server also supports these operations when explicitly
started with `BURETTE_DEV_SSH=1`. It uses the same Python worker and OpenSSH,
requires loopback clients and exact same-origin POST requests with a custom
header, and never exposes SSH credentials to the browser. Preview copies live
in a private session directory under `node_modules/.cache` (256 files / 512 MiB),
removed on server shutdown. This is a local development capability; hosted
widgets, Quick Look, iPhone and the packaged molecular MCP do not gain access.

```sh
BURETTE_DEV_SSH=1 vp dev apps/desktop --host 127.0.0.1 --port 1551 --strictPort --config apps/desktop/vite.config.ts
```

The Codex application screenshots are a UX reference. The public Codex CLI source
examined for this feature did not contain that SSH connection manager, so this
implementation uses OpenSSH directly and copies no Codex implementation code.

## Validation

Run `python3 tests/test-ssh-reader.py`, frontend typechecking, focused Rust
validation, and a uniquely namespaced native app. Native acceptance must add a
real SSH folder and open a remote molecular structure, then exercise refresh and
an unavailable host. Run `bun tests/test-browser-dev-ssh.mjs` for browser bridge boundary checks.
With `BURETTE_SSH_TEST_HOST` and `BURETTE_SSH_TEST_ROOT` set to an authorized
folder containing `mini.pdb`, it also tests real listing, download, and traversal
rejection. Browser acceptance must show an actual remote molecule, not just a
connection status. Native and browser acceptance remain separate.

## Chemical tree and folder actions

Remote project expansion searches up to 64 directories, 12 levels, 2,000 entries
and 1.5 seconds per request. It expands branches to the first chemical files.
Hidden/service folders and plain JSON are excluded; ambiguous text formats are
checked for chemical signatures within a 1 MiB total sniff budget. Incomplete
branches stay available for manual expansion. The folder chooser remains an
unfiltered directory picker. Nested folder menus refresh, collapse, copy a path,
or save that folder as a separate project without modifying remote files.

Browser development reuses one sequential Python worker per SSH host, with at
most four sessions, two active requests globally, and a 60-second idle expiry.
Responses have bounded length headers; cancellation or timeout closes the session.
Native requests still use independent SSH processes; both surfaces share the
bounded discovery worker.
