# Burrete CLI installer

This package provides the `burrete` command for installing the Burrete macOS
app from GitHub Releases.

```bash
bunx burrete install
bunx burrete doctor
bunx burrete plugin install
```

The command downloads the latest stable `Burrete-<version>.zip`,
verifies the GitHub release asset SHA-256 digest when GitHub provides one, and
installs `Burrete.app` into `~/Applications` by default.

Use `burrete install --system` to install into `/Applications` for all users;
without it, the installer uses the current user's `~/Applications` folder.
Use `burrete install --beta` to install from the beta channel instead.

Run `burrete doctor` after installation to check that `Burrete.app`, the Quick
Look extension, `qlmanage`, and the installed app version are visible.

## Codex plugin

Burrete releases include a local Codex plugin bundle. Install or update it with:

```bash
bunx burrete plugin install
bunx burrete plugin status
```

The command auto-detects `plugins/burette-agent` from a source checkout or from
an installed `Burrete.app`, then copies it into the local Codex plugin cache. If
the app is not installed yet, pass the bundle path explicitly:

```bash
bunx burrete plugin install --path /path/to/Burrete/plugins/burette-agent
```

Use `--skip-deps` only when plugin dependencies are already present or managed
by Codex.
