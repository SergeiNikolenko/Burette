// Settings-owned viewer and grid defaults reach open frames as typed messages
// instead of rebuilding the documents; Quick Look toggles touch no frame.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let source = readFileSync("apps/desktop/src/hooks/use-app-preference-effects.ts", "utf8").replace(/^import .*;\n/gm, "").replace("export function", "function");
source = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
const refs = [], effects = [];
let refIndex = 0, effectIndex = 0, pending = [];
const hook = new Function("useRef", "useEffect", "isTauriRuntime", "isTemporaryDocumentPath", "useAppLevelPreferences", source + "\nreturn useAppPreferenceEffects;")(
  value => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
  (run, dependencies) => {
    const index = effectIndex++;
    if (!effects[index] || dependencies.some((value, i) => value !== effects[index][i])) pending.push(run);
    effects[index] = dependencies;
  }, () => false, () => false, () => {},
);
const posted = [];
globalThis.document = { querySelectorAll: () => [{ contentWindow: { postMessage: message => posted.push(message.body) } }] };
const opened = [];
const base = { gridViewMode: "cards", screenshotFormat: "png", quickLookGridSdf: true };
const options = {
  activeTab: { id: "a", location: { kind: "file", path: "/a.sdf" } }, activeTabId: "a",
  documents: [{ id: "a", path: "/a.sdf" }],
  openDocuments: async paths => { opened.push(paths); return { documents: [], errors: [] }; },
  preferences: base, pushErrorStatus() {}, isDocumentDirty: () => false,
  skipNextPreferenceRefreshRef: { current: false },
};
function render(changes) {
  Object.assign(options, changes); refIndex = 0; effectIndex = 0; pending = [];
  hook(options); for (const effect of pending) effect();
}

render({});
render({ preferences: { ...base, gridViewMode: "table", screenshotFormat: "webp" } });
render({ preferences: { ...base, gridViewMode: "table", screenshotFormat: "webp", quickLookGridSdf: false } });
assert.deepEqual(posted, [
  { type: "setGridViewModeDefault", value: "table" },
  { type: "setScreenshotFormatDefault", value: "webp" },
]);
assert.deepEqual(opened, [], "viewer defaults must not rebuild open documents");
console.log("Viewer defaults live-update checks passed.");
