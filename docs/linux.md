# Burette On Linux

The Burette desktop workspace runs on 64-bit x86 Linux. Releases ship it as a
deb package, an rpm package and an AppImage. Finder Quick Look and the iPhone
app remain Apple-only surfaces.

## Install

| Distribution | Command |
| --- | --- |
| Debian, Ubuntu | `sudo apt install ./Burette_<version>_amd64.deb` |
| Fedora, RHEL, openSUSE | `sudo dnf install ./Burette-<version>-1.x86_64.rpm` |
| Any other | `chmod +x Burette_<version>_amd64.AppImage && ./Burette_<version>_amd64.AppImage` |

Burette needs WebKitGTK 4.1, which Ubuntu 22.04, Debian 12, Fedora 39 and
later provide. The deb and rpm packages declare it as a dependency.

## Desktop Integration

The deb and rpm packages install a desktop entry and a shared-mime-info
package (`/usr/share/mime/packages/burette.xml`). Both are generated from
`config/preview-formats.json`, the registry the macOS `Info.plist` follows, by
`scripts/linux-desktop-metadata.mjs`; `bun run check:formats` fails when the
checked-in copies under `packaging/linux/` are stale.

- Distinctive molecular extensions (`.pdb`, `.cif`, `.sdf`, `.mol2`, `.xtc`,
  `.mvsx`, and so on) get MIME types that open in Burette.
- Extensions that other programs own on Linux (`.log`, `.out`, `.csv`, `.json`,
  `.xml`, `.com`, `.rtf`, `.map`, `.nc` and similar) are not claimed. Burette
  still opens them from its own Open dialog and project sidebar, and it is
  offered in Open With for CSV and TSV.
- `burette://` links register through `x-scheme-handler/burette`.

Files and links arrive as command-line arguments. A second launch hands them
to the running instance over D-Bus. The AppImage does not register file types
by itself; use AppImageLauncher or the deb/rpm package for that.

Burette keeps its data in the XDG directories for the `com.local.BuretteV10`
identifier: settings and workspaces under `~/.local/share`, caches and the
action journal (`ActionJournal.jsonl`) under `~/.cache`.

## Differences From macOS

| Area | macOS | Linux |
| --- | --- | --- |
| Window | Translucent window with the traffic lights inside the toolbar | Opaque window with the system title bar and a GTK menu bar. Quit ends the File menu, Settings ends Edit, and Check for Updates and About end Help. |
| Shortcuts | Command (⌘) | Control; the Command modifier maps to Super. Tab cycling uses Ctrl+Tab. |
| File previews | Finder Quick Look and thumbnails | Not available. |
| Native compute | Metal on Apple Silicon | CPU reference implementations; the GPU (Metal) setting is hidden. |
| Context menus | AppKit menus, including slider, colour and text rows | GTK menus for command menus; menus with live controls use the in-app menu. |
| Tabs | Drag tabs between windows, drag files out, tab hover previews | Tabs move between windows through their menus; no drag-out or hover previews. |
| Updates | Sparkle installs in place | The update check reports new versions and opens the release page. |
| Database passwords | Login keychain | Secret Service (GNOME Keyring or KWallet). |
| Trash, notifications, keeping awake | Finder Trash, Notification Center, `caffeinate` | freedesktop Trash, the desktop notification server, `systemd-inhibit`. |

The packages bundle the same locked xyzrender and RDKit runtime as the Mac app,
under `/usr/lib/Burette/xyzrender-runtime` and `xyzrender-python`. Its Linux
lock, `config/xyzrender/requirements-linux-x86_64.txt`, pins the same versions
as the macOS lock. The managed xTB installation uses the same Pixi lock, which
lists `linux-64` and `linux-aarch64`. CREST, PRISM, Python and `uv` are found on
`PATH`, as on macOS.

## Build From Source

On Debian or Ubuntu:

```bash
./scripts/install-linux-build-deps.sh
./scripts/build-linux.sh
```

Other distributions need the equivalent WebKitGTK 4.1, GTK 3, libsoup 3,
librsvg and `rpm` packages, plus Bun and Rust. The script prepares the locked
xyzrender runtime (or reuses `BURETTE_XYZRENDER_ENV`), then writes the bundles
and a `SHA256SUMS` file to `build/linux/`. Set `BURETTE_LINUX_BUNDLES=deb` (or
`rpm`, `appimage`, or a comma-separated list) to build fewer bundles.

Rust validation on Linux covers the whole workspace:

```bash
bun scripts/stage-native-widget.mjs
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Pull requests that touch native code run the same checks and the bundle build
in the `Linux Bundle Build` CI job, which uploads the bundles as an artifact.
