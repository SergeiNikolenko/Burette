import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
let source = readFileSync("apps/desktop/src/hooks/use-app-preference-effects.ts", "utf8").replace(/^import .*;\n/gm, "").replace("export function", "function");
source = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
const refs = [], effects = [];
let refIndex = 0, effectIndex = 0, pending = [];
const hook = new Function("useRef", "useEffect", "isTauriRuntime", "isTemporaryDocumentPath", source + "\nreturn useAppPreferenceEffects;")(
  value => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
  (run, dependencies) => {
    const index = effectIndex++;
    if (!effects[index] || dependencies.some((value, i) => value !== effects[index][i])) pending.push(run);
    effects[index] = dependencies;
  }, () => false, () => false,
);
const documents = [{ id: "a", path: "/a.pdb" }, { id: "b", path: "/b.pdb" }];
const opened = [];
const dirty = new Set();
const options = {
  activeTab: { id: "settings", location: { kind: "settings" } }, activeTabId: "settings", documents,
  openDocuments: async paths => { opened.push(paths); return { documents: [], errors: [] }; },
  preferences: { rendererMode: "molstar" }, pushErrorStatus() {}, setActiveTab() {},
  isDocumentDirty: document => dirty.has(document.id),
  skipNextPreferenceRefreshRef: { current: false },
};
function render(changes) {
  Object.assign(options, changes); refIndex = 0; effectIndex = 0; pending = [];
  hook(options); for (const effect of pending) effect();
}
render({});
render({ preferences: { rendererMode: "xyzrender" } });
assert.deepEqual(opened, []);
render({ activeTab: { id: "a", location: { kind: "file", path: "/a.pdb" } }, activeTabId: "a" });
assert.deepEqual(opened, [["/a.pdb"]], "returning from Settings must refresh the stale file runtime");
dirty.add("b");
render({ activeTab: { id: "b", location: { kind: "file", path: "/b.pdb" } }, activeTabId: "b" });
assert.equal(opened.length, 1, "preferences must not discard dirty runtime state");
dirty.delete("b");
render({ isDocumentDirty: document => dirty.has(document.id) });
assert.deepEqual(opened, [["/a.pdb"], ["/b.pdb"]]);
render({});
assert.equal(opened.length, 2, "a current runtime is not reopened repeatedly");
console.log("Preference runtime refresh checks passed.");

const requests = [];
render({ openDocuments: (_paths, _reload, _preferences, request) => {
  requests.push(request);
  return new Promise(() => {});
} });
render({ preferences: { rendererMode: "molstar" } });
const older = requests.at(-1);
render({ preferences: { rendererMode: "xyzrender" } });
const newer = requests.at(-1);
assert.notEqual(older, newer);
assert.equal(older.shouldApply(), false, "a superseded preferences request must not replace a newer runtime");
assert.equal(newer.shouldApply(), true);
render({ documents: documents.filter(document => document.id !== "b") });
assert.equal(newer.shouldApply(), false, "closing during preparation must not reopen the document");
console.log("Stale/closed preference rebuild checks passed.");
