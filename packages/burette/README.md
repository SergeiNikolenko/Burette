# Burette CLI installer

This package provides the `burette` command for installing the Burette macOS
app from GitHub Releases.

```bash
bunx burette install
bunx burette doctor
```

The command downloads the latest stable `Burette-<version>.zip`,
verifies the GitHub release asset SHA-256 digest when GitHub provides one, and
installs `Burette.app` into `~/Applications` by default.

Use `burette install --system` to install into `/Applications` for all users;
without it, the installer uses the current user's `~/Applications` folder.
Use `burette install --beta` to install from the beta channel instead.

Run `burette doctor` after installation to check that `Burette.app`, the Quick
Look extension, `qlmanage`, and the installed app version are visible.
