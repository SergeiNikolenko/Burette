# Scene and generated document names

Status: proposed behavior; automatic scene naming is not implemented yet.

A name should describe the content. Ketcher, Mol*, and xyzrender describe the
editor or renderer and belong in provenance or view controls, not generated
filenames. Keep the file's identity separate from the current scene's title.

## Naming rules

| Situation | Display name | Suggested save name |
| --- | --- | --- |
| Known, unchanged molecule imported from a collection | ethanol | ethanol.sdf |
| New drawing with no reliable molecule name | Molecule 1 | Molecule 1.sdf |
| Two structures in a scene | ethanol + acetic acid | ethanol + acetic acid.svg for a scene image |
| More structures | ethanol + 3 | ethanol + 3.svg for a scene image |
| Existing file alone | Its actual filename | Its actual filename |
| Manually named scene | The manual name | The manual name with the chosen format |

The export name follows the exported scope: exporting one selected structure
uses that structure's name, even if the enclosing scene contains several items.
A scene image uses the scene name. Do not imply that a molecular file contains
the whole scene when only one object is exported.

New unnamed documents receive a stable workspace number when created. A redraw,
rerender, reopen, or switch of renderer must not increment that number. File
creation still uses collision-safe suffixes at the chosen destination.

## What causes an update

Update an automatic scene name after successful addition, replacement, removal,
or explicit renaming of scene objects. Do not update it on selection, hover,
hiding, camera changes, layout changes, or temporary import progress. Reordering
objects keeps a stable primary object rather than making the title jump.

An imported molecule's chemical name remains valid only while its chemical
identity is unchanged. Editing its structure must not silently keep an old name
such as ethanol for a different compound. Fall back to the stable unnamed label
unless the resulting structure has a reliable name supplied by the user or data.
Do not guess identity from a formula or make unsolicited external name lookups.

## Identity and persistence

- Keep document ID, source path, display title, and suggested export basename
  distinct. Changing a scene title never moves or renames a file on disk.
- Preserve explicit user names. Store whether the name is automatic or manual;
  do not infer that distinction from a string such as `ketcher-sketch`.
- Existing saved filenames remain stable. Show the source filename/path in the
  tooltip or inspector when a composite scene has a different display title.
- Keep origin metadata such as Ketcher separate from the current title.
- Persist naming mode, stable unnamed number, and primary scene object with the
  existing document/session state. Undo/redo restores the corresponding title.

## Implementation boundaries

1. Centralize generated document naming so opening from Ketcher, dragging from
   Ketcher, and saving/exporting share one rule. Preserve reliable record names.
2. Have the viewer publish a bounded summary of actual scene objects after
   committed changes, including removal and undo. Validate the mounted source
   iframe; do not derive a title from the requested drag payload before it loads.
3. Resolve tab and scene-export titles from that summary without altering source
   paths or replacing the original molecule document.
4. Check new drawings, imported/editing molecules, multiple additions, failed
   imports, deletion, undo/redo, manual names, export scope, duplicate names,
   restored sessions, and browser/native parity.
