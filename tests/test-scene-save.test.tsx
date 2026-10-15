import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const scene = () => ({ id: "scene", path: "/cache/scene.pdb", title: "My scene", sceneSourcePaths: ["/a.pdb", "/b.pdb"], sceneUnsaved: true });
let documents = [scene()];
const snapshot = mock(async () => ({ dataBase64: "UEsAAf8=" }));
const save = mock(async (): Promise<string | null> => "/saved.molx");
const invoke = mock(async () => "/saved.molx");
const tauriCore = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, invoke }));
mock.module("@tauri-apps/plugin-dialog", () => ({ save }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true }));
mock.module("../apps/desktop/src/lib/viewer-bridge", () => ({ requestViewerAction: snapshot, requestGridView: async () => {} }));
mock.module("../apps/desktop/src/hooks/workspace-scene-import", () => ({ appendScenePayload: async () => {}, focusSceneDocument: async () => {} }));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: { getState: () => ({ documents }), setState: (update: (s: { documents: ReturnType<typeof scene>[] }) => { documents: ReturnType<typeof scene>[] }) => { documents = update({ documents }).documents; } } }));
const { createRoot } = await import("react-dom/client");
const { useWorkspaceFileActions } = await import("../apps/desktop/src/hooks/use-workspace-file-actions");
async function fixture(run: (api: ReturnType<typeof useWorkspaceFileActions>, open: ReturnType<typeof mock>) => Promise<void>) {
  documents = [scene()]; snapshot.mockClear(); invoke.mockClear(); save.mockReset(); save.mockImplementation(async () => "/saved.molx");
  let api!: ReturnType<typeof useWorkspaceFileActions>; const open = mock(async () => {});
  function Hook() { api = useWorkspaceFileActions({ tabs: [], pinnedStructurePaths: [], documents } as never, { openPaths: open, selectDocument: () => {}, selectTab: () => {}, togglePinnedStructure: () => {} } as never); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<Hook />));
  try { await run(api, open); } finally { await act(async () => root.unmount()); host.remove(); }
}
test("Save Scene writes the exact binary MOLX archive, opens it and clears saved scene dirty state", async () => {
  await fixture(async (api, open) => {
    await api.saveScene(documents[0] as never);
    expect(snapshot).toHaveBeenCalledWith("scene", { type: "workspace_scene_snapshot" });
    expect(save.mock.calls[0][0]).toMatchObject({ defaultPath: "My scene.molx", filters: [{ name: "Molecular Scene", extensions: ["molx"] }] });
    expect(invoke).toHaveBeenCalledWith("write_base64_file", { request: { outputPath: "/saved.molx", contentsBase64: "UEsAAf8=" } });
    expect(open).toHaveBeenCalledWith(["/saved.molx"]); expect(documents[0].sceneUnsaved).toBe(false);
  });
});
test("cancelling save preserves unsaved scene without writing or opening a path", async () => {
  await fixture(async (api, open) => {
    save.mockImplementationOnce(async () => null); await api.saveScene(documents[0] as never);
    expect(documents[0].sceneUnsaved).toBe(true); expect(invoke).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
});
test("new imports while save dialog is open remain dirty after older snapshot is saved", async () => {
  await fixture(async (api) => {
    save.mockImplementationOnce(async () => { documents = [{ ...documents[0], sceneSourcePaths: [...documents[0].sceneSourcePaths, "/c.pdb"] }]; return "/saved.molx"; });
    await api.saveScene(documents[0] as never);
    expect(documents[0].sceneUnsaved).toBe(true); expect(documents[0].sceneSourcePaths).toEqual(["/a.pdb", "/b.pdb", "/c.pdb"]);
  });
});
