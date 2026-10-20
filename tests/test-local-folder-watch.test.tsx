import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tick: () => Promise<void>, changed: () => void, sceneOpen = true;
let files = ["/set/a.pdb", "/set/unselected.pdb"], pendingScan: Promise<unknown> | undefined;
let remainingFailures = 0;
const calls: Array<{ paths: string[]; target?: string; signal: AbortSignal }> = [];
mock.module("../apps/desktop/src/hooks/file-open-batch", () => ({
  isBatchSceneOpen: () => sceneOpen,
  openFileBatch: async (paths: string[], options: { targetDocumentId?: string; signal: AbortSignal; onProgress: (v: unknown) => void }) => {
    calls.push({ paths, target: options.targetDocumentId, signal: options.signal });
    const failures = remainingFailures > 0 ? (remainingFailures--, [{ path: paths[0], message: "File is still being written" }]) : [];
    const result = { total: paths.length, completed: paths.length, opened: paths.length - failures.length, failures, cancelled: false, documentId: "scene" };
    options.onProgress(result); return result;
  },
}));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: { subscribe: (callback: () => void) => { changed = callback; return () => {}; } } }));
mock.module("../apps/desktop/src/components/folder-open-dialog", () => ({ readFolderContents: async () => { if (pendingScan) await pendingScan; return { files, folders: [], truncated: false }; } }));
mock.module("../apps/desktop/src/components/ui/toast", () => ({ toast: { add: () => {} } }));
browser.setInterval = ((callback: () => Promise<void>) => { tick = callback; return 1; }) as typeof browser.setInterval;
browser.clearInterval = () => {};
const { createRoot } = await import("react-dom/client");
const { useLocalFileBatch } = await import("../apps/desktop/src/hooks/use-local-file-batch");

test("watch is opt-in, imports only newly appearing structures, and stops immediately when the target closes during a scan", async () => {
  let batch!: ReturnType<typeof useLocalFileBatch>;
  function Harness() { batch = useLocalFileBatch({} as never, {} as never); return null; }
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await batch.open(["/set/a.pdb"], "scene"); await tick(); });
    expect(batch.watching).toEqual([]); expect(calls).toHaveLength(1);
    await act(async () => { await batch.open(["/set/a.pdb"], "scene", { path: "/set", recursive: true, baseline: [...files] }); });
    files.push("/set/new.pdb", "/set/notes.txt");
    await act(async () => { await tick(); await tick(); });
    expect(calls.map(c => [c.paths, c.target])).toEqual([
      [["/set/a.pdb"], undefined], [["/set/a.pdb"], undefined], [["/set/new.pdb"], "scene"],
    ]);
    let release!: () => void; pendingScan = new Promise(resolve => { release = () => resolve(undefined); });
    let scanning!: Promise<void>;
    await act(async () => { scanning = tick(); sceneOpen = false; changed(); files.push("/set/late.pdb"); release(); await scanning; });
    expect(batch.watching).toEqual([]); expect(calls).toHaveLength(3);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});

test("watch retries incomplete new files and stops after three failed attempts", async () => {
  sceneOpen = true; pendingScan = undefined; calls.length = 0; remainingFailures = 0; files = ["/set/a.pdb"];
  let batch!: ReturnType<typeof useLocalFileBatch>;
  function Harness() { batch = useLocalFileBatch({} as never, {} as never); return null; }
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await batch.open(files, "scene", { path: "/set", recursive: false, baseline: [...files] }); });
    files = [...files, "/set/writing.pdb"]; remainingFailures = 3;
    await act(async () => { await tick(); await tick(); await tick(); await tick(); });
    expect(calls.slice(1).map(call => call.paths)).toEqual(Array.from({ length: 3 }, () => ["/set/writing.pdb"]));
    expect(batch.watching).toEqual([]);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});

test("Open all reads fresh folder contents and excludes notes from the shared scene", async () => {
  sceneOpen = true; pendingScan = undefined; calls.length = 0;
  files = ["/set/a.pdb", "/set/sub/b.cif", "/set/notes.txt"];
  let batch!: ReturnType<typeof useLocalFileBatch>;
  function Harness() { batch = useLocalFileBatch({ sidebarProjects: [] } as never, {} as never); return null; }
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await batch.openFolder("/set"); });
    expect(calls.map(call => call.paths)).toEqual([["/set/a.pdb", "/set/sub/b.cif"]]);
    expect(batch.watching).toEqual([]);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});

test("fresh protein/ligand folders open as docking runs while watched folders keep incremental scenes", async () => {
  let batch!: ReturnType<typeof useLocalFileBatch>;
  const docking: unknown[] = [];
  const paths = ['/run/poses.sdf', '/run/receptor.pdb', '/run/crystal.sdf'];
  const actions = { openDockingDocument: async (receptor: string, ligands: string[], options: { shouldApply: () => boolean }) => {
    docking.push([receptor, ligands, options.shouldApply()]); return { id: 'docking' };
  } };
  function Harness() { batch = useLocalFileBatch({} as never, actions as never); return null; }
  const mount = document.createElement('div'); document.body.append(mount); const root = createRoot(mount);
  calls.length = 0; sceneOpen = true;
  try {
    await act(async () => root.render(<Harness />));
    let result: unknown;
    await act(async () => { result = await batch.open(paths, 'scene'); });
    expect(result).toEqual({ total: 3, completed: 3, opened: 3, failures: [], cancelled: false, documentId: 'docking' });
    expect(docking).toEqual([['/run/receptor.pdb', ['/run/poses.sdf', '/run/crystal.sdf'], true]]);
    expect(calls).toHaveLength(0);
    await act(async () => { await batch.open(paths, 'scene', { path: '/run', recursive: false, baseline: paths }); });
    expect(calls).toHaveLength(1);
    expect(docking).toHaveLength(1);
    const oversized = ['/run/receptor.pdb', ...Array.from({length: 200}, (_, i) => `/run/${i}.sdf`)];
    await act(async () => { await expect(batch.open(oversized, 'scene')).rejects.toThrow('200'); });
    expect(docking).toHaveLength(1);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});

test("cancelling a pending docking folder invalidates its document apply guard", async () => {
  let batch!: ReturnType<typeof useLocalFileBatch>, shouldApply!: () => boolean, finish!: () => void;
  const actions = { openDockingDocument: async (_receptor: string, _ligands: string[], options: { shouldApply: () => boolean }) => {
    shouldApply = options.shouldApply;
    await new Promise<void>(resolve => { finish = resolve; });
    expect(shouldApply()).toBe(false);
    return null;
  } };
  function Harness() { batch = useLocalFileBatch({} as never, actions as never); return null; }
  const mount = document.createElement('div'); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<Harness />));
    let pending!: ReturnType<typeof batch.open>;
    await act(async () => { pending = batch.open(['/run/receptor.pdb', '/run/poses.sdf'], 'scene'); });
    expect(shouldApply()).toBe(true);
    batch.cancel();
    let result: unknown;
    await act(async () => { finish(); result = await pending; });
    expect(result).toEqual({ total: 2, completed: 0, opened: 0, failures: [], cancelled: true });
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
