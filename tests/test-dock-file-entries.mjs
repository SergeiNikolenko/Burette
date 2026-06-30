#!/usr/bin/env node
import assert from "node:assert/strict";

const { defaultDockTabs, dockFileEntries, dockTabCatalog, ensureDefaultDockTabs, persistentDockTabs } = await import("../apps/desktop/src/lib/dock.ts");

function document(id, path, title = path.split("/").at(-1) ?? id) {
  return {
    id,
    path,
    title,
    extension: path.split(".").at(-1) ?? "pdb",
    renderer: "molstar",
    runtimePath: "<html></html>",
    byteCount: 128,
  };
}

function textDocument(id, path, title = path.split("/").at(-1) ?? id) {
  return {
    id,
    path,
    title,
    extension: path.split(".").at(-1) ?? "txt",
    content: "text",
    byteCount: 16,
  };
}

const entries = dockFileEntries({
  dockDrops: [{
    id: "drop-1",
    area: "right",
    tabKind: "files",
    title: "drop",
    detail: "drop",
    addedAt: 1,
    payload: {
      paths: ["/tmp/a.pdb", "/tmp/b.sdf", "/tmp/a.pdb"],
      records: [],
      items: [{ kind: "ketcher", title: "Ketcher", detail: "Sketcher" }],
    },
  }],
  documents: [
    document("doc-a", "/tmp/a.pdb", "a.pdb"),
    document("doc-b", "/tmp/b.sdf", "b.sdf"),
  ],
  textDocuments: [],
  activeDocumentId: "doc-b",
  activeTool: null,
});

assert.deepEqual(entries.map((entry) => entry.key), [
  "document:doc-a",
  "document:doc-b",
  "tool:ketcher",
]);

const activeOnlyEntries = dockFileEntries({
  dockDrops: [],
  documents: [],
  textDocuments: [textDocument("text-1", "/tmp/readme.md", "readme.md")],
  activeDocumentId: "text-1",
  activeTool: null,
});

assert.deepEqual(activeOnlyEntries.map((entry) => entry.key), ["text-document:text-1"]);

const activeTextWithDroppedStructureEntries = dockFileEntries({
  dockDrops: [{
    id: "drop-2",
    area: "right",
    tabKind: "files",
    title: "drop",
    detail: "drop",
    addedAt: 2,
    payload: {
      paths: ["/tmp/pose.sdf", "/tmp/readme.md"],
      records: [],
    },
  }],
  documents: [document("pose-doc", "/tmp/pose.sdf", "pose.sdf")],
  textDocuments: [textDocument("text-1", "/tmp/readme.md", "readme.md")],
  activeDocumentId: "text-1",
  activeTool: null,
});

assert.deepEqual(activeTextWithDroppedStructureEntries.map((entry) => entry.key), [
  "document:pose-doc",
  "text-document:text-1",
]);
assert.ok(activeTextWithDroppedStructureEntries.some((entry) => entry.key === "text-document:text-1"));

assert.deepEqual(defaultDockTabs("right").map((tab) => tab.kind), ["inspector", "text", "files"]);
assert.deepEqual(defaultDockTabs("bottom").map((tab) => tab.kind), ["files", "jobs"]);
assert.deepEqual(dockTabCatalog("right"), ["xyzrender", "inspector", "text", "files"]);
assert.deepEqual(dockTabCatalog("bottom"), ["files", "jobs", "folding", "spectrum", "logs"]);
assert.deepEqual(
  ensureDefaultDockTabs("right", [{ id: "dock-inspector", kind: "inspector" }, { id: "dock-files", kind: "files" }])
    .map((tab) => tab.kind),
  ["inspector", "text", "files"],
);
assert.deepEqual(
  ensureDefaultDockTabs("right", [{ id: "dock-descriptors", kind: "descriptors" }])
    .map((tab) => tab.kind),
  ["inspector", "text", "files"],
);
assert.deepEqual(
  persistentDockTabs("bottom", [{ id: "dock-folding", kind: "folding" }, { id: "dock-files", kind: "files" }])
    .map((tab) => tab.kind),
  ["files"],
);
assert.deepEqual(
  persistentDockTabs("bottom", [{ id: "dock-folding", kind: "folding" }])
    .map((tab) => tab.kind),
  ["files", "jobs"],
);

console.log("dock file entry tests passed");
