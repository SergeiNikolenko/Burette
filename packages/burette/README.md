# Internal Burette installer helper

This private workspace package implements the release and installation helper
used by repository checks. It is not published to npm: the unscoped `burette`
package name belongs to an unrelated project.

Repository contributors can run it from the repository root with
`bun packages/burette/bin/burette.mjs <command>`.

The command downloads the latest stable `Burette-<version>.zip`,
verifies the GitHub release asset SHA-256 digest when GitHub provides one, and
installs `Burette.app` into `~/Applications` by default.

Use `install --system` to install into `/Applications` for all users;
without it, the installer uses the current user's `~/Applications` folder.
Use `install --beta` to install from the beta channel instead.

Run `doctor` after installation to check that `Burette.app`, the Quick
Look extension, `qlmanage`, and the installed app version are visible.
