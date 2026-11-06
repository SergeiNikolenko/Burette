# Burette On Windows

The Burette desktop workspace runs on 64-bit x86 Windows 10 and 11. Releases
ship it as an NSIS installer, `Burette_<version>_x64-setup.exe`. Finder Quick
Look and the iPhone app remain Apple-only surfaces.

## Install

Run the installer. It installs for the current user, without administrator
rights, into `%LOCALAPPDATA%\Burette`, and adds Start menu and uninstall
entries. Burette renders through Microsoft Edge WebView2, which Windows 11 and
current Windows 10 already have; the installer downloads it when it is
missing. Release installers are not code-signed yet, so SmartScreen asks for
confirmation on first run.

## Desktop Integration

The installer associates the distinctive molecular extensions (`.pdb`, `.cif`,
`.sdf`, `.mol2`, `.xtc`, `.mvsx`, and so on) with Burette. The list,
`packaging/windows/file-associations.json`, is generated from
`config/preview-formats.json` by `scripts/desktop-metadata.mjs` with the same
exclusions as Linux: extensions that other programs own (`.log`, `.out`,
`.csv`, `.json`, `.xml`, `.com`, `.rtf`, `.map`, `.nc` and similar) are not
associated, because the installer would make Burette their default handler.
Compound suffixes such as `.mae.gz` cannot be associated on Windows, and
`.msp` (a Windows Installer patch) is left alone. Burette still opens all of
these from its own Open dialog and project sidebar.

Files arrive as command-line arguments, and a second launch hands them to the
running instance.

Burette keeps settings and workspaces in `%APPDATA%\com.local.BuretteV10` and
caches, the action journal (`ActionJournal.jsonl`) and the runtimes it installs
on demand (descriptor and model Python environments, model weights, managed
xTB) in `%LOCALAPPDATA%\com.local.BuretteV10`. The uninstaller offers to delete
both.

## Differences From macOS

| Area | macOS | Windows |
| --- | --- | --- |
| Window | Translucent window with the traffic lights inside the toolbar | Opaque window with the system title bar and a menu bar. Quit ends the File menu, Settings ends Edit, and Check for Updates and About end Help. |
| Shortcuts | Command (⌘) | Control; the Command modifier maps to the Windows key. Tab cycling uses Ctrl+Tab. |
| File previews | Finder Quick Look and thumbnails | Not available. |
| Native compute | Metal on Apple Silicon | CPU reference implementations; the GPU (Metal) setting is hidden. |
| Tabs | Drag tabs between windows, drag files out, tab hover previews | Tabs move between windows through their menus; no drag-out or hover previews. |
| Drag and drop | Files from Finder, sidebar items and tabs drag into panes | Files dropped from File Explorer open. The native drop handler WebView2 needs for that turns off HTML drag and drop inside the window, so sidebar items and tabs do not drag into panes; use their menus. |
| Updates | Sparkle installs in place | The update check reports new versions and opens the release page. |
| Database passwords | Login keychain | Windows Credential Manager. |
| Trash, notifications, keeping awake | Finder Trash, Notification Center, `caffeinate` | Recycle Bin, Windows notifications, `SetThreadExecutionState`. |
| SSH | `/usr/bin/ssh` | The OpenSSH client that ships with Windows (`ssh.exe`), reading `%USERPROFILE%\.ssh\config`. Remote job results unpack with the built-in `tar.exe`. |
| External editors | Applications that declare the format | Known editors (Avogadro, PyMOL, ChimeraX, VESTA and others) found in Program Files or `%LOCALAPPDATA%\Programs`. |

The installer bundles the same locked xyzrender and RDKit runtime as the Mac
app, under `xyzrender-runtime` and `xyzrender-python` in the install folder. Its
Windows lock, `config/xyzrender/requirements-windows-x86_64.txt`, pins the same
versions as the macOS lock. The managed xTB installation uses the same Pixi
lock, which lists `win-64`; it needs Pixi (`%USERPROFILE%\.pixi\bin\pixi.exe`
or on `PATH`). Conda environments are searched under `Library\bin`. CREST and
PRISM have no Windows builds; run them on an SSH host with Run on. Python and
`uv` are found on `PATH` and in `%USERPROFILE%\.local\bin`.

## Build From Source

Install Bun, Rust with the MSVC toolchain, Python 3.12 or later and the Visual
Studio C++ build tools, then run in Git Bash:

```bash
./scripts/build-windows.sh
```

The script stages the locked xyzrender runtime with
`scripts/stage-xyzrender-windows.py`, then writes the installer and a
`SHA256SUMS` file to `build/windows/`. `pwsh scripts/windows-smoke.ps1`
installs that build, opens a protein and a molecule table in it, saves
screenshots to `build/windows-smoke/` and uninstalls it.

Rust validation on Windows covers the whole workspace:

```bash
bun scripts/stage-native-widget.mjs
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Pull requests that touch native code run the same checks, the installer build
and the smoke launch in the `Windows Installer Build` CI job, which uploads the
installer and screenshots as an artifact. From Linux or macOS,
`cargo xwin check --target x86_64-pc-windows-msvc` (with `cargo-xwin`) type
checks the Windows code paths without a Windows machine.
