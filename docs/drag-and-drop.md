# Molecular drag and drop

The desktop shell resolves a drop from its destination, not the active document.
The same action resolver is used for native file drops, tab headers, the viewer
shell and sidebar. Internal tab drags reorder tabs; they do not also import a
second copy into the tab underneath.

## Destination matrix

| Source | Destination | Default result |
| --- | --- | --- |
| Collection card or table row, including a loaded selection | Folder or project root in the left sidebar | Create one real molecular file per record, refresh the tree and open the saved files |
| Collection records | Empty workspace, blank sidebar, or blank tab strip | Open separate structure documents |
| Collection records or structure files | Existing xyzrender tab or sheet | Add structures to that sheet; preserve the original structure |
| Collection records or compatible files | Grid tab | Append records to that document |
| Compatible collection files | Collection document | Merge into the destination collection |
| MOL, SDF, SMILES or RXN | Ketcher | Import structures/reactions; existing alternatives remain available |
| Structure files | Workspace or folder row | Open documents; existing files are not moved or copied |
| Protein/ligand or coordinate/trajectory inputs | Compatible viewer/workflow | Existing contextual docking, combined-scene or trajectory choices |

Hovering a destination tab activates it after the existing delay. Leaving the
header or cancelling the drag clears that timer. A compact native label follows the pointer; the action label stays anchored to
the receiving surface. No travelling import icon or animated target outline is
used. Collection rows and shell files/tabs share this compact treatment. Native
Retina coordinates are normalized once for the host before hit-testing;
WKWebView reports logical points and other hosts report physical pixels. A
distant dock is never preferred through a second coordinate fallback.

## Reliability and limits

- A collection drag transfers at most 200 loaded records and 24 MiB of text. A
  selection containing unloaded remote rows is rejected with an explanation;
  it is never silently truncated.
- Folder writes use a sanitized basename and exclusive creation. A name collision
  gets a numbered suffix; existing files and symlinks are never overwritten.
  Individual write failures are reported alongside successfully saved files.
- Browser-dev file creation is confined to the existing allowed filesystem roots.
  DWAR, RXN and RDF are accepted by the browser text-file drag reader; acceptance
  does not imply that every renderer understands every format.
- Cross-iframe drag feedback receives a bounded payload only from a mounted
  viewer. Protected `dragover` data is not treated as an empty structure.
- WKWebView native events may consume internal HTML drops without file paths.
  The native drag session retains the source records until drop or leave, even
  when the source iframe reports drag end first.
- Sheet additions wait for readiness from the actual destination iframe, including
  inactive/loading tabs. A queue is bounded to 200 sources / 24 MiB and is cleared
  when the document closes.
- A tab-header drop has no canvas coordinates. Automatic layout fits additions
  side by side in the visible viewport, accounting for zoom and pan. Manually
  positioned/resized items retain their placement. A direct canvas drop uses the
  actual drop point in sheet coordinates.

## Focused checks

`tests/test-drop-actions.mjs` covers the action matrix. `tests/test-drop-routing.mjs`
executes the shell hook and checks destination identity, folder routing, browser
formats, and multiple cold-tab drops with a matching-frame readiness handshake.
`tests/test-browser-dev-path-boundaries.mjs` and the Rust `file_operations` tests
check unique creation, traversal rejection and overwrite protection.
`tests/test-xyzrender-sheet-editing.mjs` checks layout under zoom/pan and preservation
of manual placement. Browser UI and the separately built native app remain
separate acceptance surfaces.

Native internal tab drops on the tab strip dispatch `burette-native-tab-drop`
with `{ tabId, x }` to the tab owner for reordering. They never enter molecular
import routing. Native enter may precede the grid source message; the validated
message fills the pending native payload before drop.
