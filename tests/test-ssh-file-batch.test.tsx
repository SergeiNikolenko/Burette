import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { SshDirectory, SshProject } from "../apps/desktop/src/lib/ssh-projects";
import type { FileBatchProgress } from "../apps/desktop/src/lib/file-open-queue";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const listeners = new Set<() => void>();
let sceneOpen = true;
const list = mock(async (): Promise<SshDirectory> => listing(["a.pdb"]));
const preview = mock(async (_project: SshProject, path: string) => `/cache/${path}`);
const batch = mock(async (paths: string[], options: { signal: AbortSignal; targetDocumentId?: string }): Promise<FileBatchProgress> => ({
  total: paths.length, completed: paths.length, opened: paths.length, failures: [], cancelled: options.signal.aborted, documentId: options.targetDocumentId ?? "scene",
}));
mock.module("../apps/desktop/src/lib/ssh-projects", () => ({ sshList: list, sshPreview: preview }));
mock.module("../apps/desktop/src/hooks/file-open-batch", () => ({ openFileBatch: batch, isBatchSceneOpen: () => sceneOpen }));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: { subscribe: (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback); } } }));
const { createRoot } = await import("react-dom/client");
const { useSshFileBatch } = await import("../apps/desktop/src/components/ssh/use-ssh-file-batch");
const project: SshProject = { id: "remote", name: "Remote", host: "test", root: "/work" };
let current!: ReturnType<typeof useSshFileBatch>;
function Hook({ enabled }: { enabled: boolean }) { current = useSshFileBatch(project, {} as ShellActions, enabled); return null; }
function listing(paths: string[], size = 10): SshDirectory { return { root: "/work", path: ".", entries: paths.map(name => ({ name, directory: false, size })), truncated: false }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

async function fixture(run: (tick: () => Promise<void>, disable: () => Promise<void>) => Promise<void>) {
  list.mockReset(); list.mockImplementation(async () => listing(["a.pdb"]));
  batch.mockReset(); batch.mockImplementation(async (paths, options) => ({ total: paths.length, completed: paths.length, opened: paths.length, failures: [], cancelled: options.signal.aborted, documentId: options.targetDocumentId ?? "scene" }));
  listeners.clear(); sceneOpen = true;
  const timers = new Map<number, () => void>(); let timerId = 0;
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: () => void, delay?: number, ...args: unknown[]) => {
    if (delay !== 5000) return originalSet(callback, delay, ...args);
    const id = ++timerId; timers.set(id, callback); return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => { if (typeof id === "number" && timers.delete(id)) return; originalClear(id); }) as typeof clearTimeout;
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<Hook enabled />));
    await run(async () => {
      const entry = timers.entries().next().value;
      expect(entry).toBeDefined();
      timers.delete(entry![0]);
      await act(async () => { entry![1](); for (let step = 0; step < 12; step++) await Promise.resolve(); });
    }, async () => { await act(async () => root.render(<Hook enabled={false} />)); });
  } finally {
    await act(async () => root.unmount()); mount.remove();
    expect(timers.size).toBe(0); expect(listeners.size).toBe(0);
    globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
  }
}

test("watch waits for stable new file size and appends into the same scene", async () => {
  await fixture(async tick => {
    await act(async () => current.open([], "scene", ".", true));
    expect(current.watching).toBe(".");
    list.mockImplementation(async () => listing(["a.pdb", "b.pdb"], 20));
    await tick(); expect(batch).toHaveBeenCalledTimes(1);
    await tick();
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[1][0]).toEqual(["b.pdb"]);
    expect(batch.mock.calls[1][1].targetDocumentId).toBe("scene");
    await tick(); expect(batch).toHaveBeenCalledTimes(2);
  });
});

test("closing the scene stops the watcher immediately without a further directory scan", async () => {
  await fixture(async () => {
    await act(async () => current.open([], "scene", ".", true));
    expect(listeners.size).toBe(1);
    const signal = batch.mock.calls[0][1].signal;
    await act(async () => { sceneOpen = false; [...listeners].forEach(listener => listener()); });
    expect(current.watching).toBeNull(); expect(current.busy).toBe(false);
    expect(signal.aborted).toBe(true); expect(listeners.size).toBe(0);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

test("a stale directory poll cannot cancel a replacement open operation", async () => {
  await fixture(async tick => {
    await act(async () => current.open([], "scene", ".", true));
    const stale = deferred<SshDirectory>(); list.mockImplementationOnce(() => stale.promise);
    await tick();
    const replacement = deferred<FileBatchProgress>(); batch.mockImplementationOnce(() => replacement.promise);
    let replacing!: Promise<void>;
    await act(async () => { replacing = current.open(["replacement.pdb"], "scene"); });
    const signal = batch.mock.calls[1][1].signal;
    await act(async () => stale.resolve(listing(["a.pdb", "old.pdb"])));
    expect(signal.aborted).toBe(false); expect(current.busy).toBe(true);
    await act(async () => { replacement.resolve({ total: 1, completed: 1, opened: 1, failures: [], cancelled: false, documentId: "replacement" }); await replacing; });
    expect(current.busy).toBe(false);
  });
});

test("disable cancels transfer and watcher; partial folder discovery never opens a partial scene", async () => {
  await fixture(async (_tick, disable) => {
    await act(async () => current.open([], "scene", ".", true));
    const signal = batch.mock.calls[0][1].signal;
    await disable(); expect(signal.aborted).toBe(true); expect(current.watching).toBeNull();
    list.mockImplementation(async () => ({ ...listing(["a.pdb"]), partial: true }));
    await act(async () => current.open([], "scene", ".", false));
    expect(batch).toHaveBeenCalledTimes(1);
    expect(current.error).toContain("smaller subfolder");
  });
});
