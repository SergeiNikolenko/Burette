import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript-compiler-api";

const source = readFileSync("apps/desktop/src/hooks/use-workspace-file-actions.ts", "utf8");
const fragment = source.slice(source.indexOf("  const saveScene ="), source.indexOf("  const openRecordScene ="));
const js = ts.transpileModule(fragment.replace('await import("../stores/molecule-store")', '({ useMoleculeStore: moleculeStore })'), { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
const camera = { position: [12, -4, 27], target: [1, 2, 3], up: [0, 1, 0] };
const session = JSON.stringify({ entries: [{ snapshot: { camera: { current: camera }, data: { transforms: ["protein", "ligand"] } } }] });
const document = { id: "scene", title: "protein.pdb" };
const output = "/Users/test/saved/Binding site.molx";

for (const outcome of ["saved", "cancelled", "failed"]) {
  for (const pinned of [false, true]) {
    const calls = [];
    const state = { tabs: [{ title: "Binding site", location: { kind: "file", documentId: document.id } }], pinnedStructurePaths: pinned ? [output] : [] };
    const persistScene = new Function("state", "actions", "focusViewer", "requestViewerAction", "window", "isTauriRuntime", "save", "invoke", "moleculeStore", `${js}; return saveScene;`)(state, {
      openPaths: async paths => { calls.push(["open", paths]); },
      togglePinnedStructure: path => calls.push(["pin", path]),
    }, async doc => calls.push(["focus", doc.id]), async (id, action) => {
      calls.push(["export", id, action.type]); return { dataBase64: btoa(session) };
    }, { dispatchEvent: event => calls.push(["event", event.type]) }, () => true,
    async request => { calls.push(["save", request]); return outcome === "cancelled" ? null : output; },
    async (command, request) => { calls.push([command, request]); if (outcome === "failed") throw new Error("write failed"); return output; },
    { setState: update => update({ documents: [document] }) });
    if (outcome === "failed") await assert.rejects(persistScene(document), /write failed/);
    else await persistScene(document);
    assert.deepEqual(calls, [
      ["focus", "scene"], ["export", "scene", "workspace_scene_snapshot"],
      ["save", { title: "Save Scene", defaultPath: "Binding site.molx", filters: [{ name: "Molecular Scene", extensions: ["molx"] }] }],
      ...(outcome !== "cancelled" ? [["write_base64_file", { request: { outputPath: output, contentsBase64: btoa(session) } }]] : []),
      ...(outcome === "saved" ? [
        ["open", [output]], ...(!pinned ? [["pin", output]] : []), ["event", "burette-folder-contents-changed"],
      ] : []),
    ]);
  }
}
console.log("Scene save preserves snapshot bytes, opens and pins the saved file, and skips cancelled or failed exports");
