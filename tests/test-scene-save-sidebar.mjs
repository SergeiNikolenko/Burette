import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript-compiler-api";

const source = readFileSync("apps/desktop/src/hooks/use-workspace-file-actions.ts", "utf8");
const fragment = source.slice(source.indexOf("  const saveScene ="), source.indexOf("  const openRecordScene ="));
const js = ts.transpileModule(fragment, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
const camera = { position: [12, -4, 27], target: [1, 2, 3], up: [0, 1, 0] };
const session = JSON.stringify({ entries: [{ snapshot: { camera: { current: camera }, data: { transforms: ["protein", "ligand"] } } }] });
const document = { id: "scene", title: "protein.pdb" };
const output = "/Users/test/saved/Binding site.molj";

for (const outcome of [{ status: "saved", path: output }, { status: "cancelled" }, { status: "failed", message: "write failed" }, { status: "saved", path: null }]) {
  for (const pinned of [false, true]) {
    const calls = [];
    const state = { tabs: [{ title: "Binding site", location: { kind: "file", documentId: document.id } }], pinnedStructurePaths: pinned ? [output] : [] };
    const save = new Function("state", "actions", "focusViewer", "requestViewerAction", "window", `${js}; return saveScene;`)(state, {
      saveKetcherExportFile: async request => { calls.push(["save", request]); return outcome; },
      openPaths: async paths => { calls.push(["open", paths]); },
      togglePinnedStructure: path => calls.push(["pin", path]),
    }, async doc => calls.push(["focus", doc.id]), async (id, action) => {
      calls.push(["export", id, action.type]); return { dataBase64: btoa(session) };
    }, { dispatchEvent: event => calls.push(["event", event.type]) });
    await save(document);
    assert.deepEqual(calls, [
      ["focus", "scene"], ["export", "scene", "export_session"],
      ["save", { title: "Binding site.molj", extension: "molj", text: session }],
      ...(outcome.status === "saved" && outcome.path ? [
        ["open", [output]], ...(!pinned ? [["pin", output]] : []), ["event", "burette-folder-contents-changed"],
      ] : []),
    ]);
  }
}
console.log("Scene save preserves snapshot bytes, opens and pins the saved file, and skips cancelled/failed/pathless exports");
