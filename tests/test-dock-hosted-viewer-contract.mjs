// A document hosted in the dock panel must reach the same host message
// handlers as the same document in a tab. The host routes viewer messages by
// iframe identity (`.viewer-iframe[data-document-id]`), so the dock frame has
// to carry the same class and data attributes, and the read-only marker may
// only strip write-back actions - never the whole feature.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const dockPanel = read("apps/desktop/src/components/dock-panel.tsx");
const viewerFrame = read("apps/desktop/src/components/editor-area/viewer-frame.tsx");
const filePageKind = read("apps/desktop/src/components/editor-area/page-kinds/file.tsx");
const textFilePageKind = read("apps/desktop/src/components/editor-area/page-kinds/text-file.tsx");
const viewerBridge = read("apps/desktop/src/lib/viewer-bridge.ts");
const viewerBridgeMessages = read("apps/desktop/src/lib/viewer-bridge-messages.ts");
const viewerBridgeMessagesHook = read("apps/desktop/src/hooks/use-app-viewer-bridge-messages.ts");
const gridWorkspaceMenuHook = read("apps/desktop/src/hooks/use-grid-workspace-menu.ts");
const gridControlMessagesHook = read("apps/desktop/src/hooks/use-app-grid-control-messages.ts");
const gridFileActionsHook = read("apps/desktop/src/hooks/use-app-grid-file-actions.ts");

// The dock renders the shared ViewerFrame with the default class, so every
// selector-based lookup in the host sees the dock frame next to the tab frame.
assert.match(dockPanel, /<ViewerFrame document=\{dockDocument\} readOnly \/>/);
assert.match(filePageKind, /<ViewerFrame\s+document=\{document\}/);
assert.match(viewerFrame, /className = "viewer-iframe",/);
assert.match(viewerFrame, /"data-document-id": document\.id,\s*"data-renderer": document\.renderer,\s*"data-read-only": readOnly \? "true" : undefined,\s*name: readOnly \? "burette-read-only" : "burette-editable",/);
assert.match(viewerFrame, /body: \{ type: "gridReadOnlyChanged", readOnly: true \}/);

// Text documents in the dock get the same viewer props as the text tab.
const textViewerProps = /<TextFileViewer document=\{\w+\} openPaths=\{actions\.openPaths\} onStructureSelection=\{actions\.selectTextStructure\} \/>/;
assert.match(dockPanel, textViewerProps);
assert.match(textFilePageKind, textViewerProps);

// One window listener dispatches every viewer message; the only gate is the
// frame being a known viewer iframe, which the dock frame satisfies.
assert.match(viewerBridgeMessagesHook, /window\.addEventListener\("message", onMessage\)/);
assert.match(viewerBridgeMessages, /if \(!handlers\.isKnownViewerMessageSource\(eventSource, viewerBridgeBodyDocumentId\(body\)\)\) \{\s*return false;/);
assert.doesNotMatch(viewerBridgeMessages, /isReadOnlyViewerMessageSource/);
assert.doesNotMatch(viewerBridgeMessages, /page-surface/);
assert.match(viewerBridge, /querySelectorAll<HTMLIFrameElement>\("\.viewer-iframe\[data-document-id\]"\)/);
assert.match(viewerBridge, /querySelectorAll<HTMLIFrameElement>\("\.viewer-iframe\[data-read-only=\\"true\\"\]"\)/);
// Host -> viewer lookups prefer the editable tab frame and fall back to the
// dock frame when the document lives only there.
assert.match(viewerBridge, /`\.viewer-iframe\[data-document-id="\$\{escapedId\}"\]\$\{rendererSelector\}:not\(\[data-read-only="true"\]\)`,\s*\) \?\? document\.querySelector<HTMLIFrameElement>\(\s*`\.page-surface\[data-active="true"\] \.viewer-iframe\[data-document-id="\$\{escapedId\}"\]\$\{rendererSelector\}`,\s*\) \?\? document\.querySelector<HTMLIFrameElement>\(\s*`\.viewer-iframe\[data-document-id="\$\{escapedId\}"\]\$\{rendererSelector\}`,/);

// The grid's native molecule menu is served for the dock frame too; read-only
// only removes the entries that write back into the collection.
assert.match(gridWorkspaceMenuHook, /if \(body\?\.type !== "gridWorkspaceMenu" \|\| !isKnownViewerMessageSource\(event\.source\)\) return;/);
assert.doesNotMatch(gridWorkspaceMenuHook, /\|\| isReadOnlyViewerMessageSource\(event\.source\)\) return/);
assert.match(gridWorkspaceMenuHook, /const readOnly = isReadOnlyViewerMessageSource\(event\.source\);/);
assert.match(gridWorkspaceMenuHook, /const READ_ONLY_HIDDEN_ENTRIES = new Set\(\["ketcher", "duplicate", "remove"\]\);/);
assert.match(gridWorkspaceMenuHook, /if \(readOnly && READ_ONLY_HIDDEN_ENTRIES\.has\(id\)\) return \[\];/);
assert.match(gridWorkspaceMenuHook, /querySelectorAll<HTMLIFrameElement>\('\.viewer-iframe\[data-renderer="grid2d"\]'\)/);
for (const id of ["open", "copy", "copy-smiles", "copy-name", "export", "select-row", "pubchem-identity", "filter-cell"]) {
  assert.match(gridWorkspaceMenuHook, new RegExp(`take\\("${id}", `), `${id} stays available in a read-only frame`);
}

// Read-only frames keep every non-writing grid message; only edits and saves
// are refused.
assert.match(gridControlMessagesHook, /if \(readOnlySource && body\?\.type === "openInKetcher" && body\.gridEdit === true\) return true;/);
assert.match(gridFileActionsHook, /if \(isReadOnlyViewerMessageSource\(source\)\s*&& \(body\?\.type === "saveGrid" \|\| body\?\.type === "saveGridAs" \|\| body\?\.type === "saveGridRow"\)\)/);
// Dirty tracking and the native menu-bar state belong to the editable frame;
// no other grid message is gated on the read-only marker.
assert.match(gridControlMessagesHook, /if \(body\?\.type === "gridDirtyChanged"\) \{\s*if \(readOnlySource\) return true;/);
assert.match(gridControlMessagesHook, /if \(body\?\.type === "gridMenuStateChanged"\) \{\s*if \(readOnlySource\) return true;/);
assert.equal((gridControlMessagesHook.match(/readOnlySource/g) ?? []).length, 4);

console.log("dock-hosted viewer contract ok");
