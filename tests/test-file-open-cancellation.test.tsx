import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let backend: () => Promise<unknown> = async () => ({ documents: [], errors: ["invalid structure"] });
const invoke = mock(async (command: string, args: { paths?: string[] }) => {
  if (command === "classify_open_paths") return { files: args.paths, directories: [], errors: [] };
  if (command === "open_documents") return backend();
  throw new Error(command);
});
const abortClaims = mock(async () => {});
const tauriCore = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true, trackTauriListener: () => () => {} }));
mock.module("../apps/desktop/src/lib/open-document-claims", () => ({ abortOpenDocumentClaims: abortClaims }));
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
async function fixture(run: (hook: ReturnType<typeof useAppFileOpen>, add: ReturnType<typeof mock>) => Promise<void>) {
  const add = mock(() => {}); let hook!: ReturnType<typeof useAppFileOpen>;
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
test("successful strict open installs the document once and a pre-cancelled open never touches backend", async () => {
  const doc = { id: "ok", path: "/a.pdb", renderer: "molstar" }; backend = async () => ({ documents: [doc], errors: [] });
  await fixture(async (hook, add) => {
    await hook.openPaths(["/a.pdb"], { requireSuccess: true }); expect(add).toHaveBeenCalledWith([doc]); expect(add).toHaveBeenCalledTimes(1);
    invoke.mockClear(); await hook.openPaths(["/other.pdb"], { shouldApply: () => false, requireSuccess: true }); expect(invoke).not.toHaveBeenCalled();
  });
});
