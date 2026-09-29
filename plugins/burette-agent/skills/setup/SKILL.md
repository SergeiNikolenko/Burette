---
name: setup
description: "Use right after Burette is installed to confirm the viewer works and show the user where Burette lives in Codex."
---

# Set Up Burette

Run this once after installation. Keep it short: one working structure on
screen, then a few sentences on where Burette appears.

1. Open the bundled example with `burette.open_viewer` and `{ "example": "1htb" }`.
   It needs no project folder or network. Observe the returned session with
   `burette.observe_inline_viewer` until `ready` is true before saying the
   structure is shown. `awaiting_mount` means the card appears when the chat is
   visible; it is not a failure.
2. Tell the user where else Burette is available:
   - **Burette** in the sidebar opens a full workspace of its own.
   - **Molecule Workspace** opens Burette as a tab beside any chat.
   - Molecular files (`.pdb`, `.cif`, `.sdf`, `.mol`, `.xyz` and others) can be
     opened with Burette from the file viewer.
   - Typing `@Burette` with a protein name or PDB ID in the composer finds PDB
     entries to mention.
3. Offer one next step, such as opening their own structure file or a PDB ID.

If the example does not open, report the tool error as returned. Do not open the
Burette desktop app or edit Burette source code to repair the plugin.
