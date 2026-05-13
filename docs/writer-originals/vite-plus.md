# Using Vite+, the Unified Toolchain for the Web

This project uses Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`.

## Core Rules

- Use `vp` for package management and frontend tooling.
- Do not use pnpm, npm, or Yarn directly.
- Use built-in Vite+ commands such as `vp dev`, `vp build`, `vp check`, `vp lint`, `vp fmt`, and `vp test`.
- When a built-in `vp` command name conflicts with a `package.json` script, use `vp run <script>`.
- Import JavaScript tooling APIs from `vite-plus` or `vite-plus/test`, not `vite` or `vitest`.

## Common Commands

### Start

- `vp install` or `vp i` - Install dependencies
- `vp env` - Manage Node.js versions
- `vp config` - Configure hooks and agent integration
- `vp staged` - Run linters on staged files

### Develop

- `vp dev` - Run the development server
- `vp check` - Run format, lint, and TypeScript type checks
- `vp lint` - Run Oxlint
- `vp fmt` - Run Oxfmt
- `vp test` - Run tests through the bundled Vitest

### Execute

- `vp run <script>` - Run a `package.json` script
- `vp exec <command>` - Execute a command from local `node_modules/.bin`
- `vp dlx <package>` - Execute a package binary without installing it as a dependency
- `vp cache` - Manage the task cache

### Build

- `vp build` - Build for production
- `vp pack` - Build libraries
- `vp preview` - Preview production build

### Manage Dependencies

- `vp add <pkg>` - Add packages to dependencies
- `vp remove <pkg>` - Remove packages from dependencies
- `vp update` - Update packages to latest versions
- `vp dedupe` - Deduplicate dependencies
- `vp outdated` - Check for outdated packages
- `vp list` - List installed packages
- `vp why <pkg>` - Show why a package is installed
- `vp info <pkg>` - View package information from the registry
- `vp link` / `vp unlink` - Manage local package links
- `vp pm <args...>` - Forward a command to the underlying package manager when needed

### Maintain

- `vp upgrade` - Update `vp` itself to the latest version
- `vp --version` - Show the current Vite+ version
- `vp help` or `vp <command> --help` - Show command help

## Common Pitfalls

- Do not run package manager commands directly; use `vp` instead.
- Do not try to run wrapped tools directly as `vp vitest` or `vp oxlint`; use `vp test` and `vp lint`.
- Built-in Vite+ commands do not run same-named `package.json` scripts. Use `vp run <script>` for scripts.
- Do not install Vitest, Oxlint, Oxfmt, or tsdown directly. Vite+ wraps them.
- Use `vp dlx` instead of package-manager-specific `npx` or `dlx` commands.
- Import from `vite-plus` or `vite-plus/test`, not `vite` or `vitest`.
- There is no need to install extra type-aware lint packages; `vp lint --type-aware` works out of the box.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```
