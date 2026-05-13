# Keyboard Shortcuts

Canonical shortcut reference for Burette.

## Global

These shortcuts are handled by the global `use-keyboard-shortcuts` hook unless a
modal surface such as the command palette is open.

| Shortcut | Action |
| --- | --- |
| Cmd+P | Open command palette |
| Cmd+O | Open molecular structure files |
| Cmd+\\ | Toggle sidebar |
| Cmd+, | Open Settings |
| Cmd+W | Close active structure tab |
| Cmd+1 ... Cmd+9 | Jump to the matching structure tab |

## Command Palette

These actions are available from the Writer-style command palette.

| Command | Action |
| --- | --- |
| Open Structure | Choose molecular structure files |
| Search Open Structures | Focus the sidebar structure filter |
| Settings | Open Settings |
| Hide Sidebar / Show Sidebar | Toggle sidebar |
| Close Active Structure | Close the selected molecule tab |
| Close All Structures | Clear all open molecule tabs |
| Clear Recent Structures | Clear the persisted recent structure list |
| Clear Preview Cache | Remove generated preview runtimes |
| Reset Quick Look | Refresh Finder preview registration |
| Open Logs Folder | Show Burette runtime logs |
| Check for Updates | Check Burette releases |
| Renderer: Auto | Use automatic renderer selection |
| Renderer: Mol* | Prefer Mol* rendering |
| Renderer: Fast XYZ | Prefer the fast XYZ renderer |
| Renderer: xyzrender external | Prefer the external xyzrender path |
| Open Recent: `<title>` | Open a recent molecular structure |
| Open Structure: `<title>` | Activate an already open molecular structure |

## Sidebar

The sidebar search input remains reachable from the command palette with
`Search Open Structures`. It is not the primary `Cmd+P` target anymore.

The sidebar footer stays visually aligned with Writer Computer's single compact
bottom row. Settings, Logs, and Quick Look reset remain available from the
command palette and Settings tab.

## Preview

Preview iframe controls may define their own local interactions. Global
shortcuts stay owned by the shell unless focus is inside a modal surface.
