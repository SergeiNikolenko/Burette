# SSH structure projects

In the macOS app, use **Projects → + → Add SSH Project**. Choose an alias from
`~/.ssh/config` or enter `user@hostname`, browse a remote directory, and add it
as a project. The sidebar lists directories on demand; selecting a file downloads
a preview copy and opens the existing Burette viewer. Settings → Connections
stores named SSH connections separately from projects. One host can supply
multiple project folders; connections can be disabled, checked or removed. Removing a project never deletes server files.

The remote host needs Python 3. System OpenSSH handles keys, SSH agent,
configuration and ProxyJump. Authentication must already work noninteractively,
and the host must already be trusted in known_hosts. Burette does not enroll host
keys, save passwords, install remote software or modify SSH configuration.
Host suggestions currently include literal aliases in the main config file;
aliases defined by Include can also be entered manually.

## Data and limits

- Server operations are read-only. Edits to a downloaded preview affect only its
  local copy; export locally to retain edits. Remote writeback is not implemented.
- Folder listings scan at most 2,000 entries per request. No recursive project
  scan or background host polling occurs.
- Preview downloads are limited to 64 MiB with a 45-second operation timeout.
  One SSH request runs at a time. Errors leave saved projects intact.
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
stdin to a bundled read-only Python worker, never interpolated into shell code.
The frontend uses three typed commands: `ssh_hosts`, `ssh_list`, `ssh_preview`.
The browser preview can show the UI but has no SSH access. Hosted widgets, Quick
Look, iPhone and the packaged molecular MCP do not gain remote access.

The Codex application screenshots are a UX reference. The public Codex CLI source
examined for this feature did not contain that SSH connection manager, so this
implementation uses OpenSSH directly and copies no Codex implementation code.

## Validation

Run `python3 tests/test-ssh-reader.py`, frontend typechecking, focused Rust
validation, and a uniquely namespaced native app. Native acceptance must add a
real SSH folder and open a remote molecular structure, then exercise refresh and
an unavailable host. Browser UI verification alone does not prove SSH works.
