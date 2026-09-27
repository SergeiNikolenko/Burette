import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync("apps/desktop/src/hooks/use-app-startup-effects.ts", "utf8")
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace("export function", "function"),
);

globalThis.window = {};
function startup(initialDocuments = []) {
  const refs = [], effects = [], refreshed = [], opened = [];
  let refIndex = 0, effectIndex = 0, pending = [];
  const options = {
    documents: initialDocuments, tabs: [], activeDocument: initialDocuments[0], activeTabId: null,
    openDocuments: paths => refreshed.push(paths),
    openPaths: async paths => opened.push(paths),
    setActiveTab() {}, pushErrorStatus(error) { throw error; },
  };
  const hook = new Function("dependencies", `
    const { useRef, useEffect, isTauriRuntime, isTemporaryDocumentPath, invoke, useMoleculeStore } = dependencies;
    ${source}
    return useAppStartupEffects;
  `)({
    useRef: value => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useEffect: (run, dependencies) => {
      const index = effectIndex++;
      if (!effects[index] || dependencies.some((value, i) => value !== effects[index][i])) pending.push(run);
      effects[index] = dependencies;
    },
    isTauriRuntime: () => true,
    isTemporaryDocumentPath: path => path.startsWith("burette-"),
    invoke: async (_command, { paths }) => paths,
    useMoleculeStore: { getState: () => ({ tabs: options.tabs, pruneMissingFileTabs() {} }) },
  });
  return {
    refreshed, opened,
    render(changes = {}) {
      Object.assign(options, changes);
      refIndex = 0; effectIndex = 0; pending = [];
      hook(options);
      for (const effect of pending) effect();
    },
  };
}

const documents = [{ id: "a", path: "/a.pdb" }, { id: "b", path: "/b.pdb" }];
const emptyLaunch = startup();
emptyLaunch.render();
emptyLaunch.render({ documents, activeDocument: documents[0] });
assert.deepEqual(emptyLaunch.refreshed, [], "the first user-opened document must not trigger a second startup rebuild");

const restoredLaunch = startup();
restoredLaunch.render({
  tabs: documents.map(document => ({ id: document.id, location: { kind: "file", path: document.path } })),
  activeTabId: "b",
});
await Promise.resolve();
await Promise.resolve();
restoredLaunch.render({ documents, activeDocument: documents[1] });
assert.deepEqual(
  { opened: restoredLaunch.opened, refreshed: restoredLaunch.refreshed },
  { opened: [["/a.pdb", "/b.pdb"]], refreshed: [] },
  "restoring saved tabs creates each runtime once",
);

const legacyLaunch = startup(documents);
legacyLaunch.render({ activeDocument: documents[1] });
legacyLaunch.render({ documents: [...documents] });
assert.deepEqual(legacyLaunch.refreshed, [["/b.pdb", "/a.pdb"]], "already-hydrated legacy runtimes still refresh once with the selected document first");
console.log("Startup runtime refresh checks passed.");
