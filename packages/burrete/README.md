# Burrete npm installer

This package provides the `burrete` command for installing the Burrete macOS
app from GitHub Releases.

```bash
npm exec --package burrete -- burrete install
pnpm dlx burrete install
```

The command downloads the latest non-prerelease `Burrete-<version>.zip`,
verifies the GitHub release asset SHA-256 digest when GitHub provides one, and
installs `Burrete.app` into `~/Applications` by default.

Use `burrete install --system` to install into `/Applications`.
