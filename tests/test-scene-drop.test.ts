import { beforeEach, expect, mock, test } from "bun:test";

let documents: Array<{ id: string; renderer: string; path: string }> = [];
let scans: unknown[] = [];
let hold: Promise<void> | undefined;
let fail = false;
const calls: Array<[string, Record<string, unknown>]> = [];
mock.module("@tauri-apps/api/core", () => ({ invoke: async () => scans }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true }));
mock.module("../apps/desktop/src/stores/settings-store", () => ({ useSettingsStore: { getState: () => ({ preferences: {} }) } }));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: { getState: () => ({ documents, setActiveDocument() {} }), setState() {} } }));
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureTextDocument: async (path: string) => ({ content: path, truncated: false }) }));
mock.module("../apps/desktop/src/lib/viewer-bridge", () => ({
  activeViewerIframeForDocument: () => ({ contentWindow: {} }),
  requestViewerAction: async (id: string, action: Record<string, unknown>) => {
    if (action.type === "workspace_scene_state") return { ready: true };
    calls.push([id, action]);
    if (id === "left") await hold;
    if (fail) { fail = false; throw new Error("Broken molecule"); }
    return { added: 1 };
  },
}));
const { appendSceneDrop, expandSceneDropFolders } = await import("../apps/desktop/src/hooks/workspace-scene-import");
const payload = (path: string) => ({ paths: [path], records: [] });
beforeEach(() => {
  documents = ["left", "right"].map(id => ({ id, renderer: "molstar", path: `/${id}.pdb` }));
  calls.length = 0; hold = undefined; fail = false; scans = [];
});

test("rapid drops serialize within one scene while another scene remains independent", async () => {
  let release!: () => void;
  hold = new Promise<void>(resolve => { release = resolve; });
  const first = appendSceneDrop("left", payload("/first.pdb"));
  const second = appendSceneDrop("left", payload("/second.sdf"));
  await appendSceneDrop("right", payload("/other.pdb"));
  expect(calls.map(([id]) => id).sort()).toEqual(["left", "right"]);
  release();
  await Promise.all([first, second]);
  expect(calls.filter(([id]) => id === "left").map(([, action]) => action.sources)).toEqual([
    [{ path: "/first.pdb", label: "first.pdb", format: "pdb", data: "/first.pdb" }],
    [{ path: "/second.sdf", label: "second.sdf", format: "sdf", data: "/second.sdf" }],
  ]);
  expect(calls.every(([, action]) => action.skipExisting === true)).toBe(true);
});

test("failed and closed targets do not redirect to another scene or poison the queue", async () => {
  fail = true;
  await expect(appendSceneDrop("left", payload("/broken.pdb"))).rejects.toThrow("Broken molecule");
  await appendSceneDrop("left", payload("/valid.pdb"));
  documents = documents.filter(document => document.id !== "left");
  await expect(appendSceneDrop("left", payload("/late.pdb"))).rejects.toThrow("no longer open");
  expect(calls.map(([id]) => id)).toEqual(["left", "left"]);
});

test("folders include nested supported files once; incomplete scans fail before importing", async () => {
  scans = [{ files: [{ path: "/folder/a.pdb" }, { path: "/folder/nested/b.sdf" }, { path: "/folder/notes.txt" }], truncated: false }];
  expect(await expandSceneDropFolders(["/folder/a.pdb"], ["/folder"])).toEqual(["/folder/a.pdb", "/folder/nested/b.sdf"]);
  scans = [{ files: [{ path: "/partial.pdb" }], truncated: true }];
  await expect(expandSceneDropFolders([], ["/large"])).rejects.toThrow("smaller subfolder");
  scans = [{ files: [], truncated: false, error: "Unreadable folder" }];
  await expect(expandSceneDropFolders([], ["/unreadable"])).rejects.toThrow("Unreadable folder");
  scans = [{ files: [], truncated: false }];
  await expect(expandSceneDropFolders([], ["/empty"])).rejects.toThrow("no supported structures");
});
