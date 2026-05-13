# Keyboard Shortcuts

Canonical shortcut reference for Burrete.

## Global

These shortcuts are handled unless a modal surface such as the command palette is
open.

| Shortcut | Action |
| --- | --- |
| Cmd+P | Open command palette |
| Cmd+O | Open molecular structure files |
| Cmd+\ | Toggle sidebar |
| Cmd+, | Open Settings |
| Cmd+W | Close active structure tab |
| Cmd+1 ... Cmd+9 | Jump to the matching structure tab |

## Command Palette

These actions are available from the command palette.

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
| Open Logs Folder | Show Burrete runtime logs |
| Check for Updates | Check Burrete releases |
| Renderer: Auto | Use automatic renderer selection |
| Renderer: Mol* | Prefer Mol* rendering |
| Renderer: Fast XYZ | Prefer the fast XYZ renderer |
| Renderer: xyzrender external | Prefer the external xyzrender path |
| Open Recent: `<title>` | Open a recent molecular structure |
| Open Structure: `<title>` | Activate an already open molecular structure |

## Sidebar

The sidebar supports keyboard search focus through the command palette. Structure
rows are tab-like pages; activating a row switches the active preview tab.

## Preview

Preview iframes keep their own renderer-level keyboard behavior. Do not add
global shortcuts that steal common Mol* interactions while the preview iframe is
focused.
