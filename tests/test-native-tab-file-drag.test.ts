import { beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript-compiler-api";

const calls: Array<[string, any]> = [];
let outcome = { accepted: false, inAppDrop: null as { x: number; y: number } | null };
let exported = "PK\u0003\u0004\u0000\u0080\u00ffscene";
const viewerCalls: unknown[] = [];
let sketchController: any;
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: any) => {
  calls.push([command, args]);
  if (command === "write_text_file" || command === "write_base64_file") return args.request.outputPath;
  if (command === "start_file_drag") return outcome;
  throw new Error(command);
} }));
mock.module("@tauri-apps/api/path", () => ({ appCacheDir: async () => "/cache", join: async (...parts: string[]) => parts.join("/") }));
mock.module("../apps/desktop/src/lib/viewer-bridge", () => ({ requestViewerAction: async (id: string, action: unknown) => {
  viewerCalls.push([id, action]); return { dataBase64: btoa(exported) };
} }));
mock.module("../apps/desktop/src/lib/ketcher-agent", () => ({ getKetcherAgentController: () => sketchController }));
// UI/file-materialization tests use the captured-archive boundary; real scientific captures
// run separately against Mol* and the live source controller.
mock.module("../apps/desktop/src/lib/science-session/restore", () => ({ isScienceSessionCandidate: () => false }));
mock.module("../apps/desktop/src/hooks/workspace-scene-snapshot", () => ({ captureWorkspaceSceneSnapshot: async (document: any) => {
  const { requestViewerAction } = await import("../apps/desktop/src/lib/viewer-bridge");
  const result = await requestViewerAction(document.id, { type: "workspace_scene_snapshot" });
  return { document, result: { kind: "molx", dataBase64: result.dataBase64 }, confirm: async () => {}, omissionReason: null };
} }));
const { tabFileDragPayload } = await import("../apps/desktop/src/components/editor-area/tab-file-drag");
const { startNativeFileDrag, nativeFileDragTabId, nativeFileDragPayload } = await import("../apps/desktop/src/lib/native-file-drag");
const state = { documents: [] as any[], textDocuments: [] as any[], dirtyGridDocuments: new Set<string>() };
const tab = (kind: string, path: string, extra = {}) => ({ id: path, location: { kind, path, ...extra }, back: [], forward: [] }) as any;

beforeEach(() => { calls.length = 0; viewerCalls.length = 0; sketchController = undefined; state.documents = []; state.textDocuments = []; state.dirtyGridDocuments.clear(); outcome = { accepted: false, inAppDrop: null }; });

test("real structure, text and document tabs send filesystem paths to AppKit", async () => {
  const tabs = [tab("file", "/data/a.sdf"), tab("text-file", "/data/notes.md"), tab("document", "/data/paper.pdf")];
  const payload = await tabFileDragPayload(tabs, state, null);
  await startNativeFileDrag(payload, "source-tab");
  expect(calls).toEqual([["start_file_drag", { paths: tabs.map(tab => tab.location.path) }]]);
  expect(nativeFileDragPayload(payload.paths)).toBeNull();
  outcome = { accepted: true, inAppDrop: null };
  await startNativeFileDrag(payload, "source-tab");
  expect(nativeFileDragTabId(payload.paths)).toBe("source-tab");
  expect(nativeFileDragTabId(["/another.sdf"])).toBeNull();
  nativeFileDragPayload(payload.paths, { consume: true });
  expect(nativeFileDragTabId(payload.paths)).toBeNull();
});

test("inline text, unsaved sketch and combined scene become actual cache files", async () => {
  const note = tab("text-file", "burette-ketcher-export://note");
  state.textDocuments = [{ path: note.location.path, title: "notes", extension: "txt", content: "unsaved note", truncated: false }];
  const sketch = tab("ketcher", "sketch", { draftKet: '{"root":{}}' });
  const scene = tab("file", "burette-docking://scene", { documentId: "scene" });
  state.documents = [{ id: "scene", path: scene.location.path, renderer: "molstar", title: "Complex", dockingRequest: { receptorPath: "/a.pdb", ligandPaths: ["/b.sdf"] } }];
  const payload = await tabFileDragPayload([note, sketch, scene], state, null);
  expect(calls.map(([command, args]) => [command, args.request.contents ?? atob(args.request.contentsBase64)])).toEqual([
    ["write_text_file", "unsaved note"], ["write_text_file", '{"root":{}}'], ["write_base64_file", exported],
  ]);
  expect(payload.paths.map(path => path.split("/").at(-1))).toEqual(["notes.txt", "Molecule.ket", "Complex.molx"]);
  expect(payload.paths.every(path => path.startsWith("/cache/viewer/file-drags/"))).toBe(true);
});

test("an assembled scene with an absolute source drags its full private MOLX snapshot, never just the base file", async () => {
  const scene = tab("file", "/data/base.pdb", { documentId: "assembled" });
  state.documents = [{ id: "assembled", path: scene.location.path, renderer: "molstar", title: "Combined", sceneSourcePaths: ["/data/base.pdb", "/data/ligand.sdf"], sceneUnsaved: true }];
  const previousExport = exported;
  exported = "PK\u0003\u0004" + "x".repeat(2 * 1024 * 1024); // The private route supports archives beyond the public 2 MiB cap.
  try {
    const payload = await tabFileDragPayload([scene], state, null);
    await startNativeFileDrag(payload, scene.id);
    expect(viewerCalls).toEqual([["assembled", { type: "workspace_scene_snapshot" }]]);
    expect(calls[0][0]).toBe("write_base64_file");
    expect(atob(calls[0][1].request.contentsBase64)).toBe(exported);
    expect(payload.paths[0]).toMatch(/^\/cache\/viewer\/file-drags\/[^/]+\/Combined\.molx$/);
    expect(calls[1]).toEqual(["start_file_drag", { paths: payload.paths }]);
    exported = "x".repeat(24 * 1024 * 1024 + 1);
    calls.length = 0;
    await expect(tabFileDragPayload([scene], state, null)).rejects.toThrow("Save");
    expect(calls).toEqual([]);
  } finally { exported = previousExport; }
});

test("source edits export the draft; truncated text and dirty collections never drag stale originals", async () => {
  const file = tab("file", "/data/a.pdb", { documentId: "a" });
  state.documents = [{ id: "a", path: "/data/a.pdb", title: "a.pdb", extension: "pdb" }];
  await tabFileDragPayload([file], state, { sessionForDocument: () => ({ dirty: true, content: "edited coordinates" }) } as any);
  expect(calls[0][1].request.contents).toBe("edited coordinates");
  state.dirtyGridDocuments.add("a");
  await expect(tabFileDragPayload([file], state, null)).rejects.toThrow("Save the collection changes");
  state.textDocuments = [{ path: "virtual://text", truncated: true }];
  await expect(tabFileDragPayload([tab("text-file", "virtual://text")], state, null)).rejects.toThrow("Save this document");
});

test("a mounted sketch exports current editor state instead of the persisted draft", async () => {
  const commands: unknown[] = [];
  sketchController = {
    snapshot: () => ({ apiVersion: "v1", surfaceId: "sketch", structureRevision: 7 }),
    execute: async (command: unknown) => { commands.push(command); return { ok: true, result: { formats: { ket: '{"live":true}' } } }; },
  };
  await tabFileDragPayload([tab("ketcher", "sketch", { draftKet: '{"stale":true}' })], state, null);
  expect({ commands, contents: calls[0][1].request.contents }).toEqual({
    commands: [{ type: "control_ketcher", apiVersion: "v1", surfaceId: "sketch", expectedRevision: 7, command: "get_structure", formats: ["ket"] }],
    contents: '{"live":true}',
  });
});

test("oversized tab selections and generated content are rejected before writes", async () => {
  await expect(tabFileDragPayload(Array(201).fill(tab("file", "/data/a.sdf")), state, null)).rejects.toThrow("200");
  state.textDocuments = [{ path: "virtual://note", title: "Note", content: "x".repeat(24 * 1024 * 1024 + 1) }];
  await expect(tabFileDragPayload([tab("text-file", "virtual://note")], state, null)).rejects.toThrow("Save");
  expect(calls).toEqual([]);
});

test("the tab drag handler invokes native drag and cancellation never opens or reorders", async () => {
  const source = readFileSync("apps/desktop/src/components/editor-area/editor-tabs.tsx", "utf8");
  const fragment = source.slice(source.indexOf("  const startNativeTabDrag ="), source.indexOf("  const startMouseTabReorder ="));
  const js = ts.transpileModule(fragment, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
  let dropped = 0, moved = 0, finished = 0;
  const refs = () => ({ current: false });
  const launch = new Function("removeMouseDragListeners", "selectedTabIdsRef", "latestTabsRef", "nativeDragGenerationRef", "nativeDragPendingRef", "suppressDragClickRef", "draggingTabIdRef", "setDraggingTabId", "actions", "tabFileDragPayload", "state", "sourceEditing", "startNativeFileDrag", "moveDraggedTab", "runTabDropAtPoint", "toast", "stopTabDrag", "window", `${js}; return startNativeTabDrag;`)(
    () => {}, { current: new Set() }, { current: [tab("file", "/data/a.sdf")] }, { current: 0 }, refs(), refs(), { current: null }, () => {}, { setStructureDragActive() {} },
    tabFileDragPayload, state, null, startNativeFileDrag, () => moved++, () => dropped++, { add: (error: unknown) => { throw error; } }, () => finished++, { setTimeout: (fn: () => void) => fn() },
  );
  launch("/data/a.sdf");
  await Bun.sleep(0);
  expect({ calls, dropped, moved, finished }).toEqual({ calls: [["start_file_drag", { paths: ["/data/a.sdf"] }]], dropped: 0, moved: 0, finished: 1 });
});
