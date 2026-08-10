# Keyboard Shortcuts

Canonical shortcut reference for Burette.

Desktop builds register these shortcuts as native macOS menu accelerators in
`apps/desktop/src-tauri/src/menu/build.rs`. The browser-dev runtime implements
a subset in the webview handler
`apps/desktop/src/hooks/use-keyboard-shortcuts.ts`; rows marked
"(desktop app)" have no webview handler, and shortcuts missing from the
handler (for example Cmd+Shift+W) fall back to normal browser behavior in
browser-dev. The in-app list under Help > Keyboard Shortcuts is a third
inventory (`apps/desktop/src/components/settings-panel/keyboard-shortcuts-section.tsx`);
keep all three aligned when changing shortcuts.

## Global

These shortcuts are handled unless a modal surface such as the command palette
or the hosted MCP widget is open.

| Shortcut | Action |
| --- | --- |
| Cmd+P or / | Open command palette |
| Cmd+N | Open a new Burette window |
| Cmd+T | Open a new launcher tab |
| Cmd+O | Open molecular structure files |
| Cmd+Shift+O | Open most recent structure |
| Cmd+S | Save the active text source or collection document (desktop app) |
| Cmd+Shift+S | Save the active document as a new file (desktop app) |
| Cmd+F | Find: collection grid search, otherwise focus sidebar search (desktop app) |
| Cmd+Z | Undo in the active context (workspace history, or grid undo when a collection document is active) |
| Cmd+Shift+Z | Redo in the active context |
| Cmd+B | Toggle sidebar |
| Cmd+Option+B | Toggle Inspector (right dock) |
| Cmd+J | Toggle bottom panel |
| Cmd+\ | Toggle sidebar (browser runtime) |
| Cmd+, | Open Settings |
| Cmd+W | Close the active tab |
| Cmd+Shift+W | Close the active window |
| Cmd+Q | Quit Burette (runs the exit preflight; desktop app) |
| Control+Tab | Select the next tab |
| Control+Shift+Tab | Select the previous tab |
| Cmd+Shift+R | Reveal active structure in Finder |
| Cmd+Shift+C | Copy active structure path |
| Cmd+I | Get information about the active file |
| Cmd+Shift+E | Export active external preview as PNG |
| Cmd+Option+E | Export active external preview as SVG |
| Cmd+1 ... Cmd+9 | Jump to the matching workspace tab (any tab kind) |

Undo/redo is context-dependent: the desktop Edit menu swaps the predefined
Undo/Redo items for grid Undo/Redo while a collection document is active
(`apps/desktop/src-tauri/src/menu/state.rs`).

## Tab Strip

The focused tab strip supports multi-selection:

| Shortcut | Action |
| --- | --- |
| Cmd+click | Toggle a tab in the selection |
| Shift+click | Extend the selection as a range |
| Cmd+A | Select all tabs in the focused strip |
| Escape | Clear the tab selection |

## Command Palette

These actions are available from the command palette.

| Command | Action |
| --- | --- |
| Open Structure | Choose molecular structure files |
| Open from Clipboard | Open structure content from the clipboard |
| Fetch Structure URL in Mol* | Load a structure from a URL in Mol* |
| New Window | Open a new Burette window |
| Open Recent | Open the most recent structure |
| Search Projects and Structures | Focus the sidebar project filter |
| Settings | Open Settings |
| Ketcher | Open the Ketcher sketcher tab |
| FEP Network Preview | Open a GraphML ligand-network preview |
| Codex Agent | Open the Codex agent surface |
| Hide Sidebar / Show Sidebar | Toggle sidebar |
| Close Active Tab | Close the selected tab |
| Close All Tabs | Close all workspace tabs |
| Clear Recent Structures | Clear the persisted recent structure list |
| Clear Preview Cache | Remove generated preview runtimes |
| Reveal in Finder | Show the active structure in Finder |
| Copy Path | Copy the active structure path |
| Get Info | Show the active structure path, renderer, format, and size |
| Export Preview as PNG | Save the active external SVG preview as a PNG |
| Export Preview as SVG | Save the active external SVG preview |
| Reset Quick Look | Refresh Finder preview registration |
| Open Logs Folder | Show Burette runtime logs |
| Export Diagnostics | Save a diagnostics bundle |
| Runtime Doctor | Run runtime health checks |
| Check for Updates | Check Burette releases |
| Renderer: Auto | Use automatic renderer selection |
| Renderer: Mol* | Prefer Mol* rendering |
| Renderer: xyzrender external | Prefer the external xyzrender path |
| `<project>: <title>` | Open or activate a structure inside a project group |

The palette also generates query-driven commands from the current input
(`apps/desktop/src/lib/shell-commands.ts`):

| Query | Generated command |
| --- | --- |
| A PDB ID such as `1abc` | `Fetch 1ABC from RCSB PDB` |
| A SMILES string | `Draw SMILES in Ketcher: <smiles>` |
| A URL | `Fetch URL in Mol*` |

## Sidebar

Cmd+F focuses the sidebar search field when no collection grid is active.
Sidebar search surfaces matching command-palette commands above project
results. Project rows toggle folder visibility. Nested structure rows switch
the active preview tab or reopen a recent structure inside the matching
project group.

## Preview

Preview iframes keep their own renderer-level keyboard behavior. Do not add
global shortcuts that steal common Mol* interactions while the preview iframe
is focused.
