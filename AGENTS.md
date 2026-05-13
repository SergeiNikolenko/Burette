# Agent Notes

This file is for coding agents working on Burrete. Keep user-facing installation
and usage instructions in `README.md`.

## Project Shape

Burrete is a macOS menu bar app plus a Quick Look Preview Extension for molecular
structure files. It renders structures directly in Finder previews and keeps the
main app out of the Dock.

The Quick Look extension bundle identifier is:

```text
com.local.BurreteV10.Preview
```

Keep the extension identifier stable to avoid stale Quick Look registration
conflicts while the product name remains Burrete.

Forced preview content types:

```text
com.local.burrete10.pdb
com.local.burrete10.cif
```

## Common Commands

```bash
# Build and install locally
./scripts/build.sh
./scripts/install.sh

# Force Quick Look to preview a sample
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif

# Preview a real desktop file
./scripts/force-preview.sh ~/Desktop/1HTB.pdb

# Inspect runtime logs
./scripts/tail-log.sh

# Refresh vendored Mol* assets
pnpm install --ignore-scripts
pnpm run vendor:molstar
```

## Browser Automation

For tasks that involve ChatGPT, GPT Pro, in-app browser work, website
interaction, screenshots, form filling, or web app testing, use
`[@Browser](plugin://browser-use@openai-bundled)` by default before falling back
to direct macOS browser automation. This includes Pro review prompts and
browser-based verification tasks.

For those browser tasks, make the Browser window visible to the user by default
so it opens side-by-side in Codex. After selecting the `iab` browser, call the
Browser visibility capability with `set(true)` before navigating, typing, or
submitting prompts. Keep it visible unless the user explicitly asks to run
browser work in the background.

For local app previews, use the same visible Browser flow by default:

1. Check whether another agent already has a preview server or native Burrete
   instance running. Do not start a competing instance on the same port or with
   the same visible name.
2. Start the app's lightweight dev server in a persistent shell session, usually
   `./scripts/dev.sh <free-port> "<worktree-specific instance name>"`.
3. Select the Browser `iab` target and set visibility to `true` before opening
   the preview.
4. Navigate the visible Browser window to the local URL, for example
   `http://127.0.0.1:5177/?instance=Burrete%20Dev%203345%3A5177`, so the user
   can see the named app side-by-side with Codex while changes are being made.
5. After visual changes, refresh or reopen that Browser URL and inspect the
   actual rendered DOM/screenshot before claiming the UI matches the target.
6. Stop temporary preview servers before finishing unless the user asks to keep
   them running.

## Development Instance Labeling

During development, make test app instances visibly distinguishable from an
installed or production Burrete app. Start Vite through `./scripts/dev.sh` and
pass a short human-readable instance name as the second argument, for example
`./scripts/dev.sh 5177 "Burrete Dev 3345:5177"`. Without an explicit name, the
script derives one from the current worktree and port. The shell title and
in-app badge must show that name as `Burrete Dev: <name>` / `Dev: <name>`. When
opening a specific Browser preview URL, include `?instance=<name>` to override
the script default for that visible tab.

Do not launch native test windows through `open -a Burrete` during development.
If native verification is necessary, use `./scripts/open-dev-app.sh` so the
process receives `BURRETE_DEV_INSTANCE_NAME` and the window title is clearly
distinguishable from the installed app and from other agents' instances.

After installing or replacing the app, refresh Quick Look:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

## CI And Releases

Pull requests run the full CI workflow on macOS: pnpm dependency restore, release
version checks, JavaScript syntax checks, plist linting, and a local Xcode build.
Every PR intended for merge must bump root `package.json`,
`apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`,
`MARKETING_VERSION`, and the visible About version together.

Merging to `main` builds the app and publishes a GitHub Release tagged with the
same package version. If the tag already exists, the release workflow fails so
the next PR cannot overwrite an existing release.

Local hooks use lefthook:

```bash
pnpm install --ignore-scripts
pnpm run prepare
```

## Runtime Files

Quick Look previews are generated under the extension container cache. Burrete
keeps Mol* assets shared and writes per-preview runtime HTML/data files for
repeatable WebKit loading.

Primary log path:

```text
~/Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete/Burrete.log
```

Preview cache:

```text
~/Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete/previews
```
