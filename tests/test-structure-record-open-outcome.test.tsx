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
  if (command === "open_documents" || command === "open_text_structure") return backend(args);
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
test("structure record outcome contains exactly published documents, including partial failures", async () => {
  const document = { id: "actual", path: "/cache/actual.cif", title: "actual.cif", renderer: "molstar" };
  let attempts = 0;
  backend = async () => { if (++attempts === 2) throw new Error("Invalid CIF"); return document; };
  await fixture(async (hook, add) => {
    let opened: unknown;
    await act(async () => { opened = await hook.openStructureRecords([
      { path: "one.cif", inputExtension: "cif", text: "data_one" },
      { path: "two.cif", inputExtension: "cif", text: "data_two" },
    ]); });
    expect(opened).toEqual([document]); expect(add.mock.calls[0][0]).toEqual([document]);
    add.mockClear();
    backend = async () => { throw new Error("Invalid CIF"); };
    expect(await hook.openStructureRecords([{ path: "bad.cif", inputExtension: "cif", text: "data_bad" }])).toEqual([]);
    expect(await hook.openStructureRecords([])).toEqual([]);
    expect(add).not.toHaveBeenCalled();
  });
});
