import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
type OpenRequest = { paths?: string[]; deferRuntime?: boolean; preferences?: unknown };
let backend: (args: OpenRequest) => Promise<unknown> = async () => ({ documents: [], errors: ["invalid structure"] });
const invoke = mock(async (command: string, args: { paths?: string[] }) => {
  if (command === "classify_open_paths") return { files: args.paths, directories: [], errors: [] };
  if (command === "open_documents") return backend(args);
  throw new Error(command);
});
const abortClaims = mock(async () => {});
const tauriCore = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true, trackTauriListener: () => () => {} }));
mock.module("../apps/desktop/src/lib/open-document-claims", () => ({ abortOpenDocumentClaims: abortClaims }));
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
async function fixture(run: (hook: ReturnType<typeof useAppFileOpen>, add: ReturnType<typeof mock>) => Promise<void>) {
  useMoleculeStore.getState().setDocuments([]);
  const add = mock((documents, request) => useMoleculeStore.getState().addDocuments(documents, request)); let hook!: ReturnType<typeof useAppFileOpen>;
  const noop = () => {};
  const options = { preferences: {}, addProjectRoot: noop, addBackgroundDocuments: add, addBackgroundTextDocuments: add, addDocuments: add, addTextDocuments: add, closeDocument: noop,
    detectContentSpectrumPaths: async () => new Set(), expandStructureBundles: async (paths: string[]) => paths,
    openDockTab: noop, openDocumentsInActiveTab: add, openDocumentTab: add, openFepNetworkTab: add, openTextDocumentsInActiveTab: add,
    pushErrorStatus: noop, pushStatus: noop, rememberRecentStructures: noop, replaceDocument: noop, setActiveDocument: noop,
    setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop, setDocuments: add };
  function Hook() { hook = useAppFileOpen(options as never); return null; }
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  await act(async () => root.render(<Hook />));
  abortClaims.mockClear(); invoke.mockClear();
  try { await run(hook, add); } finally { await act(async () => root.unmount()); node.remove(); }
}
test("batch strict open reports an unreadable file instead of counting the swallowed backend failure as opened", async () => {
  backend = async () => { throw new Error("invalid PDB"); };
  await fixture(async (hook, add) => { await expect(hook.openPaths(["/bad.pdb"], { requireSuccess: true })).rejects.toThrow("could not be opened"); expect(add).not.toHaveBeenCalled(); });
});

test("bulk opening publishes first file before the tail, bounds calls, and defers unseen runtimes", async () => {
  const requests: OpenRequest[] = [];
  let releaseTail!: () => void;
  const tail = new Promise<void>((resolve) => { releaseTail = resolve; });
  backend = async (request) => {
    requests.push(request);
    if (requests.length === 2) await tail;
    return { documents: request.paths!.map((path) => ({ id: path, path, title: path, renderer: "molstar", runtimeDeferred: request.deferRuntime })), errors: [] };
  };
  const paths = Array.from({ length: 66 }, (_, index) => `/${index}.pdb`);
  await fixture(async (hook, add) => {
    const opening = hook.openDocuments([...paths, paths[0]]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(add).toHaveBeenCalledTimes(1);
    expect(requests.map((request) => request.paths!.length)).toEqual([1, 32]);
    releaseTail();
    const result = await opening;
    expect(result?.documents.map((document) => document.path)).toEqual(paths);
    expect(requests.map((request) => [request.paths!.length, request.deferRuntime])).toEqual([[1, false], [32, true], [32, true], [1, true]]);
    expect(useMoleculeStore.getState().activeDocumentId).toBe(paths[0]);
  });
});

test("bulk close while a batch is pending aborts its claims and starts no later batch", async () => {
  let resolveTail!: (value: unknown) => void;
  let calls = 0;
  backend = async (request) => {
    calls++;
    if (calls === 2) return new Promise((resolve) => { resolveTail = resolve; });
    return { documents: [{ id: "first", path: request.paths![0], renderer: "molstar" }], errors: [] };
  };
  await fixture(async (hook, add) => {
    const opening = hook.openDocuments(Array.from({ length: 66 }, (_, index) => `/${index}.pdb`));
    await new Promise((resolve) => setTimeout(resolve, 10));
    useMoleculeStore.getState().setDocuments([]);
    const late = { id: "late", path: "/1.pdb", renderer: "molstar", openClaimId: "late-claim" };
    resolveTail({ documents: [late], errors: [] });
    expect(await opening).toBeNull();
    expect(calls).toBe(2);
    expect(add).toHaveBeenCalledTimes(1);
    expect(abortClaims).toHaveBeenCalledWith([late]);
  });
});

test("combined opens stay atomic and failed first files do not hide later files", async () => {
  const requests: OpenRequest[] = [];
  backend = async (request) => {
    requests.push(request);
    if (request.paths![0] === "/bad.pdb") throw new Error("bad structure");
    return { documents: request.paths!.map((path) => ({ id: path, path, renderer: "molstar" })), errors: [] };
  };
  await fixture(async (hook) => {
    const result = await hook.openDocuments(["/bad.pdb", "/good.pdb"]);
    expect(result?.documents.map((document) => document.path)).toEqual(["/good.pdb"]);
    expect(result?.errors).toEqual(["Error: bad structure"]);
    requests.length = 0;
    await hook.openDocuments(["/a.pdb", "/b.pdb"], undefined, undefined, { mode: "combinePoses" });
    expect(requests.map((request) => [request.paths, request.deferRuntime])).toEqual([[["/a.pdb", "/b.pdb"], false]]);
  });
});
test("cancelling while native parsing is pending releases claims without installing its document", async () => {
  let resolve!: (value: unknown) => void; backend = () => new Promise(done => { resolve = done; });
  const doc = { id: "late", path: "/a.pdb", renderer: "molstar", openClaimId: "claim" };
  await fixture(async (hook, add) => {
    let active = true;
    const opening = hook.openPaths(["/a.pdb"], { requireSuccess: true, shouldApply: () => active });
    for (let i = 0; i < 16; i++) await Promise.resolve();
    expect(resolve).toBeFunction(); active = false; resolve({ documents: [doc], errors: [] }); await opening;
    expect(add).not.toHaveBeenCalled(); expect(abortClaims).toHaveBeenCalledWith([doc]);
  });
});
test("cancelling a combined grid result preserves an earlier adopted collection", async () => {
  let resolve!: (value: unknown) => void;
  backend = () => new Promise((done) => { resolve = done; });
  const previous = { id: "derived-old", path: "/folder#combined-sdf-grid:old", renderer: "grid2d", virtual: true };
  const cancelled = { id: "derived-new", path: "/folder#combined-sdf-grid:new", renderer: "grid2d", virtual: true };
  await fixture(async (hook, add) => {
    useMoleculeStore.getState().addDocuments([previous] as never);
    let active = true;
    const opening = hook.openDocuments(["/a.sdf", "/b.sdf"], undefined, undefined, { mode: "combineGrid", shouldApply: () => active });
    for (let i = 0; i < 16; i++) await Promise.resolve();
    active = false;
    resolve({ documents: [cancelled], errors: [] });
    expect(await opening).toBeNull();
    expect(add).not.toHaveBeenCalled();
    expect(abortClaims).toHaveBeenCalledWith([cancelled]);
    expect(useMoleculeStore.getState().documents).toEqual([previous]);
  });
});
test("successful strict open installs the document once and a pre-cancelled open never touches backend", async () => {
  const doc = { id: "ok", path: "/a.pdb", renderer: "molstar" }; backend = async () => ({ documents: [doc], errors: [] });
  await fixture(async (hook, add) => {
    await hook.openPaths(["/a.pdb"], { requireSuccess: true }); expect(add.mock.calls[0][0]).toEqual([doc]); expect(add).toHaveBeenCalledTimes(1);
    invoke.mockClear(); await hook.openPaths(["/other.pdb"], { shouldApply: () => false, requireSuccess: true }); expect(invoke).not.toHaveBeenCalled();
  });
});
