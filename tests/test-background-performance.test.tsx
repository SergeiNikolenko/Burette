// Run with the two browser-dev --define flags registered in vp-contract.test.mjs.
import { test, expect, mock, spyOn } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "CSS", "CustomEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let start = deferred();
let status = deferred();
const run = mock(() => start.promise), poll = mock(() => status.promise);
mock.module("../apps/desktop/src/lib/descriptors", () => ({ calculateGridDescriptors: run, gridDescriptorJobStatus: poll }));
const scans: Array<{ signal: AbortSignal; result: ReturnType<typeof deferred> }> = [];
mock.module("../apps/desktop/src/lib/browser-dev-startup", () => ({ scanBrowserDevFolders: (_roots: string[], signal: AbortSignal) => {
  const result = deferred(); scans.push({ signal, result }); return result.promise;
} }));
mock.module("../apps/desktop/src/lib/web-demo-workspace", () => ({
  isWebDemoWorkspace: () => false, subscribeWebDemoWorkspace: () => () => {},
  webDemoProjectRoot: () => null, webDemoProjectStructures: () => [],
}));
const { useAppDescriptors, GRID_DESCRIPTOR_JOB_EVENT } = await import("../apps/desktop/src/hooks/use-app-descriptors");
const { useAppSidebarProjects } = await import("../apps/desktop/src/hooks/use-app-sidebar-projects");

function controlledTimers(delay: number) {
  const pending = new Map<number, () => void>(); let serial = 9000;
  const set = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
  const setSpy = spyOn(window, "setTimeout").mockImplementation(((fn: () => void, ms: number, ...args: any[]) => {
    if (ms !== delay) return set(fn, ms, ...args);
    pending.set(++serial, fn); return serial;
  }) as typeof window.setTimeout);
  const clearSpy = spyOn(window, "clearTimeout").mockImplementation(id => { if (!pending.delete(Number(id))) clear(id); });
  return { pending, tick: () => act(async () => {
    const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn());
  }), restore: () => { setSpy.mockRestore(); clearSpy.mockRestore(); } };
}

test("folder scans do not overlap, preserve a good index on error, abort on unmount and retain memoized projects", async () => {
  expect(import.meta.env.BURETTE_BROWSER_DEV_GENERATED_FILES_ROOT).toBe("/generated");
  const timers = controlledTimers(2500);
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const errors = mock(() => {});
  const props = {
    activeDocumentId: null, browserDevExplicitFolders: ["/project"], browserDevHasExplicitWorkspace: true,
    documents: [], textDocuments: [], expandedProjectIds: [], hiddenProjectRoots: [], pinnedProjectRoots: [],
    pinnedStructurePaths: [], projectNameOverrides: {}, projectRoots: [], pruneRecentStructures: () => {},
    pruneSidebarPaths: () => {}, pushErrorStatus: errors, pushStatus: () => {}, recentStructures: [], sidebarQuery: "",
  };
  let result!: ReturnType<typeof useAppSidebarProjects>;
  function Harness() { result = useAppSidebarProjects(props); return null; }
  let mounted = true;
  try {
    await act(async () => root.render(<Harness />));
    expect(scans.length).toBe(1);
    expect(timers.pending.size).toBe(0);
    await timers.tick(); await timers.tick();
    expect(scans.length).toBe(1);
    await act(async () => scans[0].result.resolve({ files: ["/project/one.pdb"], truncated: false }));
    const projects = result.sidebarProjects;
    expect(projects.flatMap(p => p.items).map(i => i.path)).toEqual(["/project/one.pdb"]);
    await act(async () => root.render(<Harness />));
    expect(result.sidebarProjects).toBe(projects);
    expect(timers.pending.size).toBe(1);
    await timers.tick();
    expect(scans.length).toBe(2);
    expect(timers.pending.size).toBe(0);
    await act(async () => scans[1].result.reject(new Error("temporary")));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(result.sidebarProjects).toBe(projects);
    await timers.tick();
    expect(scans.length).toBe(3);
    await act(async () => root.unmount()); mounted = false;
    expect(scans[2].signal.aborted).toBe(true);
    await act(async () => scans[2].result.resolve({ files: [], truncated: true }));
    expect(timers.pending.size).toBe(0);
    expect(errors).toHaveBeenCalledTimes(1);
  } finally { if (mounted) await act(async () => root.unmount()); mount.remove(); timers.restore(); }
});

test("descriptor starts coalesce, unchanged polls stay quiet, completion permits retry and cleanup drops late results", async () => {
  const timers = controlledTimers(1200);
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const events: any[] = [], messages = mock(() => {});
  const receive = (event: Event) => events.push((event as CustomEvent).detail);
  window.addEventListener(GRID_DESCRIPTOR_JOB_EVENT, receive);
  let api!: ReturnType<typeof useAppDescriptors>;
  const documents = [{ id: "collection", path: "/collection.sdf" }] as any;
  function Harness() { api = useAppDescriptors({ documents, pushStatus: messages }); return null; }
  const running = { documentId: "window:collection", status: "running", running: true, totalRows: 5,
    processedRows: 0, calculatedRows: 0, failedRows: 0, message: "Calculating", startedAtMs: 1, summary: null };
  let mounted = true;
  try {
    await act(async () => root.render(<Harness />));
    api.calculateGridDescriptors("collection"); api.calculateGridDescriptors("collection");
    expect(run).toHaveBeenCalledTimes(1);
    expect(events.length).toBe(1);
    await act(async () => start.resolve(running));
    expect(events.length).toBe(2);
    expect(events.at(-1).documentId).toBe("collection");
    await timers.tick();
    await act(async () => status.resolve({ ...running }));
    expect(events.length).toBe(2);
    status = deferred(); await timers.tick();
    await act(async () => status.resolve({ ...running, processedRows: 1 }));
    expect(events.length).toBe(3);
    status = deferred(); await timers.tick();
    await act(async () => status.resolve({ ...running, status: "completed", running: false, processedRows: 5 }));
    expect(events.length).toBe(4);
    expect(timers.pending.size).toBe(0);
    start = deferred(); api.calculateGridDescriptors("collection");
    expect(run).toHaveBeenCalledTimes(2);
    await act(async () => start.resolve(running));
    expect(timers.pending.size).toBe(1);
    await act(async () => root.unmount()); mounted = false;
    expect(timers.pending.size).toBe(0);
    const count = events.length;
    await timers.tick(); expect(events.length).toBe(count);
    // A separate mount is disposed while its start request is still in flight.
    const nextRoot = createRoot(mount); start = deferred();
    await act(async () => nextRoot.render(<Harness />));
    api.calculateGridDescriptors("collection");
    const before = events.length, beforeMessages = messages.mock.calls.length;
    await act(async () => nextRoot.unmount());
    await act(async () => start.resolve(running));
    expect([events.length, messages.mock.calls.length, timers.pending.size]).toEqual([before, beforeMessages, 0]);
  } finally {
    if (mounted) await act(async () => root.unmount());
    window.removeEventListener(GRID_DESCRIPTOR_JOB_EVENT, receive); mount.remove(); timers.restore();
  }
});
