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
    const persistScene = new Function("state", "actions", "focusViewer", "requestViewerAction", "window", "isTauriRuntime", "save", "invoke", "moleculeStore", "captureWorkspaceSceneSnapshot", "sourceEditing", "scenePaths", "toast", `${js}; return saveScene;`)(state, {
      openPaths: async paths => { calls.push(["open", paths]); },
      togglePinnedStructure: path => calls.push(["pin", path]),
    }, async doc => calls.push(["focus", doc.id]), async (id, action) => {
      calls.push(["export", id, action.type]); return { dataBase64: btoa(session) };
    }, { dispatchEvent: event => calls.push(["event", event.type]) }, () => true,
    async request => { calls.push(["save", request]); return outcome === "cancelled" ? null : output; },
    async (command, request) => { calls.push([command, request]); if (outcome === "failed") throw new Error("write failed"); return output; },
    { setState: update => update({ documents: [document] }) },
    async doc => { calls.push(["focus", doc.id], ["export", doc.id, "workspace_scene_snapshot"]);
      return { document: doc, result: { kind: "molx", dataBase64: btoa(session) }, confirm: async () => {}, omissionReason: null };
    }, null, () => [document.id], { add: () => assert.fail("no warning for a scene without scientific data") });
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

const exportFragment = source.slice(source.indexOf("  const exportStructure ="), source.indexOf("  const copySequence ="));
const exportJs = ts.transpileModule(exportFragment, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
for (const outcome of ["saved", "missing", "changed", "capture-failed"]) {
  const downloads = [];
  const text = "exact SDF with stereo, coordinates and metadata\n$$$$\n";
  const exportStructure = new Function("captureWorkspaceSceneSnapshot", "sourceEditing", "scenePaths", "actions", `${exportJs}; return exportStructure;`)(
    async (document, options) => {
      assert.equal(options.scientificData, "require");
      assert.equal(options.sceneFileCount, 1);
      if (outcome === "capture-failed") throw new Error("binding changed");
      return { source: outcome === "missing" ? null : { extension: "sdf", text, beforeWrite: undefined }, confirm: async () => {
        if (outcome === "changed") throw new Error("source changed");
      } };
    }, null, () => ["polymer"], { saveKetcherExportFile: async value => { assert.equal(typeof value.beforeWrite, "function"); await value.beforeWrite(); downloads.push({ ...value, beforeWrite: undefined }); } });
  const document = { id: "polymer", title: "Polymer.molx" };
  if (outcome === "saved") {
    await exportStructure(document, "sdf");
    assert.deepEqual(downloads, [{ title: "Polymer.sdf", extension: "sdf", text, beforeWrite: undefined }]);
    await exportStructure({ ...document, title: "Renamed polymer" }, "sdf");
    assert.deepEqual(downloads[1], { title: "Renamed polymer.sdf", extension: "sdf", text, beforeWrite: undefined });
  } else {
    await assert.rejects(exportStructure(document, "sdf"), /changed|validated SDF/);
    assert.deepEqual(downloads, []);
  }
}
console.log("SDF export preserves the validated source and refuses absent or changed bindings before download");


const writerSource = readFileSync("apps/desktop/src/hooks/use-app-ketcher-actions.ts", "utf8");
const writerFragment = writerSource.slice(writerSource.indexOf("  const saveKetcherExportFile ="), writerSource.indexOf("  const openKetcherWithFragment ="));
const writerJs = ts.transpileModule(writerFragment, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
for (const outcome of ["saved", "changed", "cancelled"]) {
  let resolvePicker;
  const picker = new Promise(resolve => { resolvePicker = resolve; });
  const writes = [];
  let current = true;
  let confirmations = 0;
  const writer = new Function("useCallback", "safeExportFileName", "isTauriRuntime", "save", "exportDialogFilters", "invoke", "pushStatus", "pushErrorStatus", "basename", `${writerJs}; return saveKetcherExportFile;`)(
    fn => fn, name => name, () => true, () => picker, () => [],
    async (command, request) => { writes.push([command, request]); return request.outputPath; },
    () => {}, () => {}, path => path);
  const text = "validated SDF coordinates\n$$$$\n";
  const pending = writer({ title: "structure.sdf", extension: "sdf", text, beforeWrite: async () => {
    confirmations++;
    if (!current) throw new Error("source changed");
  } });
  assert.deepEqual(writes, []);
  if (outcome === "changed") current = false;
  resolvePicker(outcome === "cancelled" ? null : "/saved/structure.sdf");
  const result = await pending;
  assert.equal(result.status, outcome === "changed" ? "failed" : outcome);
  assert.equal(confirmations, outcome === "cancelled" ? 0 : 1);
  assert.deepEqual(writes, outcome === "saved" ? [["save_text_as", { text, outputPath: "/saved/structure.sdf", sourcePath: null }]] : []);
}
console.log("Native SDF writer rechecks the source after the picker and preserves cancellation and exact bytes");
