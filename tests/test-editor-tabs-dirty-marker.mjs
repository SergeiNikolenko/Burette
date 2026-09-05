import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorTabs } from "../apps/desktop/src/components/editor-area/editor-tabs.tsx";
const documents = ["a", "b"].map(id => ({ id, path: `/${id}.sdf`, title: `${id}.sdf`, renderer: "grid2d" }));
const state = {
  documents, textDocuments: [], sidebarProjects: [], activeTabId: "tab-a", activeDocument: documents[0],
  tabs: documents.map(document => ({ id: `tab-${document.id}`, location: { kind: "file", documentId: document.id, path: document.path }, back: [], forward: [] })),
  dirtyGridDocuments: new Set(["a", "b"]),
};
const actions = new Proxy({}, { get: () => () => {} });
const render = () => renderToStaticMarkup(React.createElement(EditorTabs, { state, actions }));
let html = render();
assert.match(html, /aria-label="a.sdf, Unsaved changes"/);
assert.match(html, /aria-label="b.sdf, Unsaved changes"/);
assert.equal((html.match(/data-slot="badge"/g) ?? []).length, 2);
state.dirtyGridDocuments.delete("a");
html = render();
assert.doesNotMatch(html, /aria-label="a.sdf, Unsaved changes"/);
assert.match(html, /aria-label="b.sdf, Unsaved changes"/);
assert.equal((html.match(/data-slot="badge"/g) ?? []).length, 1);
console.log("Editor tab dirty-marker render checks passed.");
