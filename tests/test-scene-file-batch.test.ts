import { expect, mock, test } from "bun:test";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { MoleculeTab } from "../apps/desktop/src/stores/molecule-store";

let documents: ViewerDocument[] = [];
let tabs: MoleculeTab[] = [];
const listeners = new Set<() => void>();
const read = mock(async () => ({ content: "ATOM", truncated: false }));
const abortClaims = mock(async () => {});
const invoke = mock(async () => ({ id: "new-scene", path: "/cache/viewer/ketcher/new/a.pdb", renderer: "molstar", runtimePath: "/cache/new/index.html" }));
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureTextDocument: read }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true }));
mock.module("../apps/desktop/src/lib/open-document-claims", () => ({ abortOpenDocumentClaims: abortClaims }));
mock.module("@tauri-apps/api/core", () => ({ invoke }));
mock.module("../apps/desktop/src/stores/settings-store", () => ({ useSettingsStore: { getState: () => ({ preferences: { rendererMode: "auto" } }) } }));
const append = mock(async (_id: string, _payload: unknown, _options: { incremental?: boolean; signal?: AbortSignal }) => ({}));
mock.module("../apps/desktop/src/hooks/workspace-scene-import", () => ({ appendScenePayload: append }));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: {
  getState: () => ({ documents, tabs, addDocuments: (incoming: ViewerDocument[]) => {
    documents = [...documents, ...incoming];
    tabs = [...tabs, ...incoming.map(document => ({ id: `tab-${document.id}`, location: { kind: "file" as const, documentId: document.id, path: document.path }, back: [], forward: [] }))];
    [...listeners].forEach(listener => listener());
  } }),
  subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
} }));
const { openFileBatch } = await import("../apps/desktop/src/hooks/file-open-batch");
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function flush() { for (let step = 0; step < 12; step++) await Promise.resolve(); }
function scene() {
  documents = [{ id: "scene", path: "/a.pdb", renderer: "molstar" }] as ViewerDocument[];
  tabs = [{ id: "tab", location: { kind: "file", documentId: "scene", path: "/a.pdb" }, back: [], forward: [] }];
  append.mockReset(); append.mockImplementation(async () => ({})); listeners.clear();
  read.mockReset(); read.mockImplementation(async () => ({ content: "ATOM", truncated: false }));
  invoke.mockReset(); invoke.mockImplementation(async () => ({ id: "new-scene", path: "/cache/viewer/ketcher/new/a.pdb", renderer: "molstar", runtimePath: "/cache/new/index.html" }));
  abortClaims.mockClear();
}

test("an existing scene is appended serially without creating or replacing a document", async () => {
  scene();
  const originalDocument = documents[0];
  const opening = mock(async () => {});
  const result = await openFileBatch(["/b.pdb", "/c.pdb"], { mode: "scene", targetDocumentId: "scene", actions: { openStructurePaths: opening, openPaths: opening } });
  expect(result).toEqual({ total: 2, completed: 2, opened: 2, failures: [], cancelled: false, documentId: "scene" });
  expect(opening).not.toHaveBeenCalled();
  expect(documents).toEqual([originalDocument]);
  expect(documents[0]).toBe(originalDocument);
  expect(append.mock.calls.map(([id, payload, options]) => ({ id, payload, incremental: options.incremental }))).toEqual([
    { id: "scene", payload: { paths: ["/b.pdb"], records: [], items: [] }, incremental: true },
    { id: "scene", payload: { paths: ["/c.pdb"], records: [], items: [] }, incremental: true },
  ]);
  expect(listeners.size).toBe(0);
});

test("closing a scene during append cancels the rest of its batch and releases subscription", async () => {
  scene();
  const pendingAppend = deferred<object>(); append.mockImplementationOnce(() => pendingAppend.promise);
  const pending = openFileBatch(["/b.pdb", "/c.pdb"], { mode: "scene", targetDocumentId: "scene", actions: { openStructurePaths: async () => {}, openPaths: async () => {} } });
  await flush(); expect(append).toHaveBeenCalledTimes(1);
  const signal = append.mock.calls[0][2].signal!;
  tabs = []; documents = []; [...listeners].forEach(listener => listener());
  expect(signal.aborted).toBe(true);
  pendingAppend.resolve({});
  const result = await pending;
  expect(result.cancelled).toBe(true); expect(append).toHaveBeenCalledTimes(1); expect(listeners.size).toBe(0);
});

test("a new batch makes an independent snapshot without reopening the original source tab", async () => {
  scene(); const original = documents[0];
  const sourceOpen = mock(async () => {});
  const result = await openFileBatch(["/a.pdb", "/b.pdb"], { mode: "scene", actions: { openPaths: sourceOpen, openStructurePaths: sourceOpen } });
  expect(result.documentId).toBe("new-scene"); expect(sourceOpen).not.toHaveBeenCalled();
  expect(documents[0]).toBe(original); expect(documents).toHaveLength(2);
  expect(documents[1]).toMatchObject({ id: "new-scene", sourcePath: "/a.pdb", sceneSourcePaths: ["/a.pdb"], virtual: true });
  expect(append.mock.calls[0][0]).toBe("new-scene");
  expect(invoke.mock.calls[0]).toEqual(["open_text_structure", { request: { title: "Scene: a.pdb", extension: "pdb", text: "ATOM" }, preferences: { rendererMode: "molstar" } }]);
});

test("cancel during snapshot creation releases claims and never adds a late scene", async () => {
  scene();
  const original = documents[0];
  const created = deferred<Awaited<ReturnType<typeof invoke>>>(); invoke.mockImplementationOnce(() => created.promise);
  const controller = new AbortController();
  const pending = openFileBatch(["/a.pdb"], { mode: "scene", signal: controller.signal, actions: { openPaths: async () => {}, openStructurePaths: async () => {} } });
  await flush(); expect(invoke).toHaveBeenCalledTimes(1); controller.abort();
  created.resolve({ id: "new-scene", path: "/temp/a.pdb", renderer: "molstar", runtimePath: "/temp/index.html" });
  expect((await pending).cancelled).toBe(true);
  expect(documents).toEqual([original]); expect(abortClaims).toHaveBeenCalledTimes(1); expect(listeners.size).toBe(0);
});

test("a duplicate append failure leaves the target intact and later new files still import", async () => {
  scene();
  append.mockImplementationOnce(async () => { throw new Error("A selected file is already in this scene."); });
  const result = await openFileBatch(["/a.pdb", "/b.pdb"], { mode: "scene", targetDocumentId: "scene", actions: { openStructurePaths: async () => {}, openPaths: async () => {} } });
  expect(result).toEqual({ total: 2, completed: 2, opened: 1, failures: [{ path: "/a.pdb", message: "Error: A selected file is already in this scene." }], cancelled: false, documentId: "scene" });
  expect(append).toHaveBeenCalledTimes(2); expect(documents[0].id).toBe("scene"); expect(listeners.size).toBe(0);
});
