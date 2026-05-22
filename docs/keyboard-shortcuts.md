# Keyboard Shortcuts

Canonical shortcut reference for Burrete.

## Global

These shortcuts are handled unless a modal surface such as the command palette is
open.

| Shortcut | Action |
| --- | --- |
| Cmd+P or / | Open command palette |
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
| Search Projects and Structures | Focus the sidebar project filter |
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
| Renderer: xyzrender external | Prefer the external xyzrender path |
| `<project>: <title>` | Open or activate a structure inside a project group |

## Sidebar

The sidebar supports keyboard search focus through the command palette. Project
rows toggle folder visibility. Nested structure rows switch the active preview
tab or reopen a recent structure inside the matching project group.

## Preview

Preview iframes keep their own renderer-level keyboard behavior. Do not add
global shortcuts that steal common Mol* interactions while the preview iframe is
focused.
