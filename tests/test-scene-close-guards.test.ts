import { expect, mock, test } from "bun:test";

let busy = false;
let owner: string | null = null;
const returning = mock(async () => { owner = null; return false; });
mock.module("../apps/desktop/src/components/workspace-panes/native-scene-window", () => ({
  nativePopoutBusy: () => busy,
  isNativePopoutTab: (id: string) => owner === id,
  returnNativePopout: returning,
}));
const { createDocumentCloseShellActions } = await import("../apps/desktop/src/hooks/use-app-shell-actions");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const confirm = mock(() => false);
Object.assign(globalThis, { window: { confirm } });

function fixture() {
  busy = false; owner = null; returning.mockClear(); confirm.mockClear(); confirm.mockReturnValue(false);
  const scene = { id: "scene", path: "/scene.pdb", sceneUnsaved: true };
  const current = { id: "current", path: "/current.pdb" };
  const tab = { id: "history-tab", back: [{ kind: "file", documentId: scene.id, path: scene.path }], location: { kind: "file", documentId: current.id, path: current.path }, forward: [] };
  useMoleculeStore.setState({ activeTabId: tab.id, tabs: [tab] as never });
  const close = mock(() => {}); const release = mock(() => {});
  const source = mock(() => true); const grid = mock(async () => ({ release }));
  const actions = createDocumentCloseShellActions({
    activeDocument: current, documents: [scene, current], tabs: [tab],
    closeTab: close, closeDocument: close, closeActiveDocument: close, closeAllDocuments: close,
    closeGridRuntime: () => {}, clearDirtyGridDocuments: () => {}, forgetDirtyGridDocument: () => {}, forgetDirtyGridDocuments: () => {},
    confirmCloseSourceDocuments: source, confirmDiscardDirtyGridDocument: grid, confirmDiscardDirtyGridDocuments: grid, pushStatus: () => {},
  } as never);
  return { actions, close, source, grid, release };
}

test("close current tab includes unsaved Back scene; cancellation leaves all runtimes and source prompts untouched", async () => {
  const f = fixture(); await f.actions.closeTab("history-tab");
  expect(confirm).toHaveBeenCalledTimes(1); expect(f.source).not.toHaveBeenCalled(); expect(f.grid).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
});

test("active and explicit document closes protect historical scenes and share the full source/grid scope", async () => {
  for (const action of ["closeActiveDocument", "closeDocument"] as const) {
    const f = fixture(); confirm.mockReturnValue(true);
    if (action === "closeDocument") await f.actions.closeDocument("current"); else await f.actions.closeActiveDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(new Set(f.source.mock.calls[0][0])).toEqual(new Set(["scene", "current"]));
    expect(new Set(f.grid.mock.calls[0][0])).toEqual(new Set(["scene", "current"]));
    expect(f.close).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledTimes(1);
  }
});

test("a pending native handoff prevents all destructive close routes", async () => {
  const f = fixture(); busy = true;
  await f.actions.closeTab("history-tab"); await f.actions.closeDocument("current"); await f.actions.closeActiveDocument();
  await f.actions.closeTabs(["history-tab"]); await f.actions.closeOtherTabs("different"); await f.actions.clearAllDocuments();
  expect(f.close).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled(); expect(returning).not.toHaveBeenCalled();
});

test("owner tab close delegates to return; parent-missing retained checkpoint is not discarded by bulk close", async () => {
  const f = fixture(); owner = "history-tab";
  await f.actions.closeTabs(["history-tab"]);
  expect(returning).toHaveBeenCalledTimes(1); expect(f.close).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
});
