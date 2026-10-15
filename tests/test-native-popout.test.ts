import { expect, mock, test } from "bun:test";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
import type { MoleculeTab } from "../apps/desktop/src/stores/molecule-store";

const calls: unknown[] = [];
let failSnapshot = false;
mock.module("@tauri-apps/api/core", () => ({ invoke: async (...args: unknown[]) => { calls.push(args); return "workspace-preview-test"; } }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true }));
mock.module("../apps/desktop/src/lib/viewer-bridge", () => ({ requestViewerAction: async () => {
  if (failSnapshot) throw new Error("Scene is still loading");
  return { dataBase64: "eyJjYW1lcmEiOnt9LCJlbnRyaWVzIjpbXX0=" };
} }));
mock.module("../apps/desktop/src/hooks/workspace-scene-import", () => ({ focusSceneDocument: async () => {} }));
mock.module("../apps/desktop/src/components/ui/toast", () => ({ toast: { add: () => {} } }));
const { openNativePopout } = await import("../apps/desktop/src/components/workspace-panes/native-popout");
const tab = { id: "hem", location: { kind: "file", documentId: "hem", path: "/source/HEM.pdb" } } as MoleculeTab;
const state = { documents: [{ id: "hem", title: "HEM.pdb", renderer: "molstar" }] } as ShellViewState;

test("a molecular popout transfers the live scene rather than rereading the original file", async () => {
  calls.length = 0;
  expect(await openNativePopout(tab, state, {} as ShellActions)).toBe(true);
  expect(calls).toEqual([["open_new_workspace_window", {
    presentation: "preview", scene: { title: "HEM", dataBase64: "eyJjYW1lcmEiOnt9LCJlbnRyaWVzIjpbXX0=" },
  }]]);
});

test("a failed scene export leaves the original view in place and opens no empty window", async () => {
  calls.length = 0; failSnapshot = true;
  try {
    expect(await openNativePopout(tab, state, {} as ShellActions)).toBe(false);
    expect(calls).toEqual([]);
  } finally { failSnapshot = false; }
});

test("non-Molstar files open in a native preview through the existing path contract", async () => {
  calls.length = 0;
  expect(await openNativePopout(tab, { documents: [] } as unknown as ShellViewState, {} as ShellActions)).toBe(true);
  expect(calls).toEqual([["open_new_workspace_window", { presentation: "preview", paths: ["/source/HEM.pdb"] }]]);
});

test("ordinary session previews use structure controls while Mesoscale keeps its own controls", async () => {
  const { isMesoscaleViewerDocument } = await import("../apps/desktop/src/lib/mesoscale-documents");
  const document = { extension: "molj", path: "/cache/scene.molj", runtimePath: "/cache/index.html" };
  expect(["structure", "mesoscale", undefined].map(viewerProfile =>
    isMesoscaleViewerDocument({ ...document, viewerProfile } as import("../apps/desktop/src/types").ViewerDocument),
  )).toEqual([false, true, true]);
});
