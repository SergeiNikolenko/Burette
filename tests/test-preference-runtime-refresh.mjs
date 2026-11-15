import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { viewerAppearanceMessage } from "../apps/desktop/src/lib/theme.ts";
import { defaultPreferences } from "../apps/desktop/src/stores/settings-store.ts";
let source = readFileSync("apps/desktop/src/hooks/use-app-preference-effects.ts", "utf8").replace(/^import .*;\n/gm, "").replace("export function", "function");
source = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
const refs = [], effects = [];
let refIndex = 0, effectIndex = 0, pending = [];
const messages = [];
const hostWindow = {}, hostThemeListeners = [];
const hook = new Function("useRef", "useEffect", "isTauriRuntime", "isTemporaryDocumentPath", "useAppLevelPreferences", "viewerAppearanceMessage", "subscribeSystemThemeMode", "window", "document", source + "\nreturn useAppPreferenceEffects;")(
  value => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
  (run, dependencies) => {
    const index = effectIndex++;
    if (!effects[index] || dependencies.some((value, i) => value !== effects[index][i])) pending.push(run);
    effects[index] = dependencies;
  }, () => false, () => false, () => {}, viewerAppearanceMessage,
  listener => { hostThemeListeners.push(listener); return () => {}; }, hostWindow,
  { querySelectorAll: () => [{ contentWindow: { postMessage: message => messages.push(message) } }] },
);
const documents = [{ id: "a", path: "/a.pdb" }, { id: "b", path: "/b.pdb" }];
const opened = [];
const dirty = new Set();
const options = {
  activeTab: { id: "settings", location: { kind: "settings" } }, activeTabId: "settings", documents,
  openDocuments: async paths => { opened.push(paths); return { documents: [], errors: [] }; },
  preferences: { ...defaultPreferences, rendererMode: "molstar" }, pushErrorStatus() {}, setActiveTab() {},
  isDocumentDirty: document => dirty.has(document.id),
  skipNextPreferenceRefreshRef: { current: false },
};
function render(changes) {
  if (changes.preferences) changes.preferences = { ...options.preferences, ...changes.preferences };
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
render({ preferences: JSON.parse(JSON.stringify(options.preferences)) });
assert.equal(opened.length, 2, "focus rehydration with equal settings must preserve the active viewer");
render({ activeTab: { id: "a", location: { kind: "file", path: "/a.pdb" } }, activeTabId: "a" });
assert.equal(opened.length, 2, "equal settings must not queue a rebuild of background viewers");
assert.equal(messages.length, 0, "equal settings need no viewer messages");
render({ activeTab: { id: "b", location: { kind: "file", path: "/b.pdb" } }, activeTabId: "b" });
dirty.add("b");
render({ preferences: { themeLightBackground: "#e7ebef", themeDarkBackground: "#253147", canvasBackground: "white" } });
assert.equal(opened.length, 2, "appearance changes never reopen a dirty scene");
assert.deepEqual(messages.at(-1), { source: "burette-host", body: viewerAppearanceMessage(options.preferences) });
assert.equal(messages.length, 1, "multiple appearance changes are one atomic update");
render({ activeTab: { id: "scene", location: { kind: "scene" } }, activeTabId: "scene", preferences: { theme: "light" } });
assert.equal(opened.length, 2, "appearance changes do not require a file-backed active tab");
assert.equal(messages.at(-1).body.value, "light");
dirty.delete("b");
render({ activeTab: { id: "b", location: { kind: "file", path: "/b.pdb" } }, activeTabId: "b" });
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
render({ preferences: JSON.parse(JSON.stringify(options.preferences)) });
assert.equal(requests.length, 2, "focus rehydration must not start another pending rebuild");
assert.equal(newer.shouldApply(), true, "equal settings must not cancel a pending real preference change");
render({ documents: documents.filter(document => document.id !== "b") });
assert.equal(newer.shouldApply(), false, "closing during preparation must not reopen the document");
console.log("Stale/closed preference rebuild checks passed.");

assert.equal(hostThemeListeners.length, 0, "desktop viewers follow the system appearance themselves");
hostWindow.BuretteMcpWorkspace = { theme: "dark" };
effects.length = 0;
render({});
const sent = messages.length;
for (const listener of hostThemeListeners) listener();
assert.deepEqual(messages.slice(sent), [{ source: "burette-host", body: viewerAppearanceMessage(options.preferences) }], "a Codex theme switch re-themes mounted widget frames");
console.log("Host theme broadcast checks passed.");
