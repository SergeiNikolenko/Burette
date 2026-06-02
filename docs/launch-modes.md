# Launch Modes

Burrete remains a normal visible macOS application by default. The main Tauri
window is configured as `visible: true`; double-clicking `Burrete.app` opens the
full desktop shell.

## Modes

- Normal user launch: opens the full app window.
- File-open launch: opens the full app window and forwards file paths to the
  desktop shell.
- Menu or tray launch: shows the full app window before dispatching menu
  actions such as Open or Settings.
- Registration or maintenance launch: may hide the main window when no file
  paths are present.
- In-app update actions: remain user-visible because they are initiated from the
  desktop shell.

## Explicit Registration Mode

Use `BURRETE_LAUNCH_MODE=register` for registration-only maintenance where a
visible app window is not needed:

```bash
BURRETE_LAUNCH_MODE=register open -n /Applications/Burrete.app
```

The same mode can be passed directly to the binary:

```bash
/Applications/Burrete.app/Contents/MacOS/burrete --burrete-launch-mode=register
```

`BURRETE_LAUNCH_MODE=normal` or no launch mode keeps the standard visible
application behavior. File arguments always take precedence over registration
mode: if a launch includes file paths, Burrete shows the main window and opens
the documents.

## Installer Behavior

`scripts/install.sh` and the package installer perform LaunchServices and Quick
Look registration directly. They do not need to launch the full app during that
maintenance path. Users can still open Burrete normally after installation.
