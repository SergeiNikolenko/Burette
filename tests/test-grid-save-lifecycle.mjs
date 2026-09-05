import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");
const cleanStart = source.indexOf("  function markGridClean()");
const cleanEnd = source.indexOf("\n  function ", cleanStart + 1);
const savedStart = source.indexOf("      if (body.type === 'gridSaved')");
const savedEnd = source.indexOf("      if (body.type === 'gridSaveError')", savedStart);
function acknowledge(state, sourceRevision) {
  new Function("state", "body", "capabilities", "config", "safeConfig", "setStatus", "updateChrome", "notifyGridDirty", "syncGridEditControls", "notifyGridMenuState",
    source.slice(cleanStart, cleanEnd) + "\n" + source.slice(savedStart, savedEnd))(
    state, { type: "gridSaved", sourceRevision }, () => ({ editing: true }), () => ({}), () => ({}), () => {}, () => {}, () => {}, () => {}, () => {},
  );
}
const laterEdits = { dirty: true, sourceRevision: 2, undoStack: [{ snapshot: { dirty: false } }, { snapshot: { dirty: true } }], redoStack: [] };
acknowledge(laterEdits, 1);
assert.equal(laterEdits.dirty, true, "an older save ACK must preserve later edits");
assert.deepEqual(laterEdits.undoStack, [{ snapshot: { dirty: true } }, { snapshot: { dirty: true } }]);
const undoneDuringSave = { dirty: false, sourceRevision: 3, undoStack: [], redoStack: [{ snapshot: { dirty: false } }] };
acknowledge(undoneDuringSave, 2);
assert.equal(undoneDuringSave.dirty, true, "undo to the old disk state must become dirty after Save changes the disk");
assert.equal(undoneDuringSave.redoStack[0].snapshot.dirty, true);
const saved = { dirty: true, sourceRevision: 2, undoStack: [{ snapshot: { dirty: false } }, { snapshot: { dirty: true } }], redoStack: [] };
acknowledge(saved, 2);
assert.equal(saved.dirty, false);
console.log("Grid save revision checks passed.");

const saveAsStart = source.indexOf("  async function saveGridAs(cfg)");
const saveAsEnd = source.indexOf("\n  async function saveGrid(cfg)", saveAsStart);
const capStart = source.indexOf("  function capabilities(cfg)");
const capEnd = source.indexOf("\n  function ", capStart + 1);
const state = { dirty: true, sourceRevision: 3, saveAsPending: false, closeTransitionActive: false };
let finishRows;
const rows = new Promise(resolve => { finishRows = resolve; });
const posts = [];
const saveAs = new Function("state", "effectiveMolecularGrid", "requireCollectionIndexReady", "syncGridEditControls", "updateChrome", "collectCurrentCollectionRows", "gridSaveAsSnapshot", "canUseNativeBridge", "post", "setStatus", "download", "markGridClean",
  source.slice(capStart, capEnd) + "\n" + source.slice(saveAsStart, saveAsEnd) + "\nreturn { saveGridAs, capabilities };")(
  state, () => true, () => true, () => {}, () => {}, () => rows,
  () => ({ name: "a.sdf", text: "snapshot" }), () => true, (...args) => posts.push(args), () => {}, () => {}, () => {},
);
const saving = saveAs.saveGridAs({});
assert.equal(state.saveAsPending, true, "Save As locks edits before asynchronous materialization");
assert.equal(saveAs.capabilities({}).editing, false);
finishRows([{}]);
await saving;
assert.equal(state.saveAsPending, true, "the lock spans the native dialog and write");
assert.equal(posts[0][2].sourceRevision, 3);
const cancelStart = source.indexOf("      if (body.type === 'gridSaveAsCancelled')");
const cancelEnd = source.indexOf("      if (body.type === 'gridSaveAsError')", cancelStart);
new Function("state", "body", "syncGridEditControls", "updateChrome", "config", source.slice(cancelStart, cancelEnd))(
  state, { type: "gridSaveAsCancelled" }, () => {}, () => {}, () => ({}),
);
assert.equal(state.saveAsPending, false);
assert.equal(state.dirty, true, "cancel leaves the original draft unsaved");
assert.equal(saveAs.capabilities({}).editing, true);
console.log("Grid Save As lock/cancel checks passed.");
