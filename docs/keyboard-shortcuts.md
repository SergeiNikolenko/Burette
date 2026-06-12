# Keyboard Shortcuts

Canonical shortcut reference for Burrete.

## Global

These shortcuts are handled unless a modal surface such as the command palette is
open.

| Shortcut | Action |
| --- | --- |
| Cmd+P or / | Open command palette |
| Cmd+O | Open molecular structure files |
| Cmd+Shift+O | Open most recent structure |
| Cmd+B | Toggle sidebar |
| Cmd+, | Open Settings |
| Cmd+W | Close active structure tab |
| Cmd+Shift+R | Reveal active structure in Finder |
| Cmd+Shift+C | Copy active structure path |
| Cmd+I | Show active structure metadata |
| Cmd+Shift+E | Export active external preview as PNG |
| Cmd+Option+E | Export active external preview as SVG |
| Cmd+1 ... Cmd+9 | Jump to the matching structure tab |

## Command Palette

These actions are available from the command palette.

| Command | Action |
| --- | --- |
| Open Structure | Choose molecular structure files |
| Open Recent | Open the most recent structure |
| Search Projects and Structures | Focus the sidebar project filter |
| Settings | Open Settings |
| Hide Sidebar / Show Sidebar | Toggle sidebar |
| Close Active Structure | Close the selected molecule tab |
| Close All Structures | Clear all open molecule tabs |
| Clear Recent Structures | Clear the persisted recent structure list |
| Clear Preview Cache | Remove generated preview runtimes |
| Reveal in Finder | Show the active structure in Finder |
| Copy Path | Copy the active structure path |
| Show Metadata | Show the active structure path, renderer, format, and size |
| Export Preview as PNG | Save the active external SVG preview as a PNG |
| Export Preview as SVG | Save the active external SVG preview |
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
