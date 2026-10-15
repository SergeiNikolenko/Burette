import { expect, test } from "bun:test";
import { runFileQueue, type FileBatchProgress } from "../apps/desktop/src/lib/file-open-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let step = 0; step < 12; step++) await Promise.resolve(); }

test("at most three paths are prefetched while viewer opens stay serial and ordered", async () => {
  const transfers = new Map(["a", "b", "c", "d", "e"].map(path => [path, deferred<string>()]));
  const firstOpen = deferred<void>();
  const requested: string[] = [], opened: string[] = [];
  let activeOpens = 0, maximumOpens = 0;
  const pending = runFileQueue(["a", "b", "c", "d", "e", "b"], {
    resolvePath: path => { requested.push(path); return transfers.get(path)!.promise; },
    open: async path => {
      opened.push(path); activeOpens++; maximumOpens = Math.max(maximumOpens, activeOpens);
      if (path === "/a") await firstOpen.promise;
      activeOpens--;
    },
  });
  await flush();
  expect(requested).toEqual(["a", "b", "c"]);
  transfers.get("c")!.resolve("/c"); transfers.get("b")!.resolve("/b");
  await flush(); expect(opened).toEqual([]);
  transfers.get("a")!.resolve("/a");
  await flush();
  expect(opened).toEqual(["/a"]);
  expect(requested).toEqual(["a", "b", "c"]);
  firstOpen.resolve();
  await flush();
  expect(requested).toEqual(["a", "b", "c", "d", "e"]);
  transfers.get("e")!.resolve("/e"); transfers.get("d")!.resolve("/d");
  expect(await pending).toEqual({ total: 5, completed: 5, opened: 5, failures: [], cancelled: false });
  expect(opened).toEqual(["/a", "/b", "/c", "/d", "/e"]);
  expect(maximumOpens).toBe(1);
});

test("download and viewer failures are attributed to source paths and later files still open", async () => {
  const opened: string[] = [], snapshots: FileBatchProgress[] = [];
  const result = await runFileQueue(["download-bad", "viewer-bad", "good"], {
    resolvePath: async path => { if (path === "download-bad") throw new Error("offline"); return `/${path}`; },
    open: async path => { if (path === "/viewer-bad") throw new Error("invalid structure"); opened.push(path); },
    onProgress: progress => snapshots.push(progress),
  });
  expect(result).toEqual({ total: 3, completed: 3, opened: 1, cancelled: false, failures: [
    { path: "download-bad", message: "Error: offline" }, { path: "viewer-bad", message: "Error: invalid structure" },
  ] });
  expect(opened).toEqual(["/good"]);
  expect(snapshots[0]).toEqual({ total: 3, completed: 0, opened: 0, failures: [], cancelled: false });
  expect(snapshots.at(-1)).toEqual(result);
});

test("cancel ignores prefetched files and starts no new downloads", async () => {
  const controller = new AbortController();
  const firstOpen = deferred<void>();
  const requested: string[] = [], opened: string[] = [];
  const pending = runFileQueue(["a", "b", "c", "d"], {
    signal: controller.signal,
    resolvePath: async path => { requested.push(path); return path; },
    open: async path => { opened.push(path); await firstOpen.promise; },
  });
  await flush();
  controller.abort(); firstOpen.resolve();
  expect(await pending).toEqual({ total: 4, completed: 1, opened: 1, failures: [], cancelled: true });
  expect(requested).toEqual(["a", "b", "c"]);
  expect(opened).toEqual(["a"]);
});

test("cancel during transfer prevents even the first viewer open", async () => {
  const controller = new AbortController();
  const download = deferred<string>();
  let opens = 0;
  const pending = runFileQueue(["a", "b"], { signal: controller.signal, resolvePath: () => download.promise, open: async () => { opens++; } });
  await flush(); controller.abort(); download.resolve("/cached");
  expect(await pending).toEqual({ total: 2, completed: 0, opened: 0, failures: [], cancelled: true });
  expect(opens).toBe(0);
});

test("already-cancelled and oversized batches cause no file operations", async () => {
  const controller = new AbortController(); controller.abort();
  let operations = 0;
  const options = { resolvePath: async (path: string) => { operations++; return path; }, open: async () => { operations++; } };
  expect(await runFileQueue(["a"], { ...options, signal: controller.signal })).toEqual({ total: 1, completed: 0, opened: 0, failures: [], cancelled: true });
  await expect(runFileQueue(Array.from({ length: 201 }, (_, index) => `${index}.pdb`), options)).rejects.toThrow("200");
  expect(operations).toBe(0);
});

test("an undefined rejection is still a failure and is never passed to the viewer", async () => {
  const opened: string[] = [];
  const result = await runFileQueue(["bad", "good"], {
    resolvePath: async path => { if (path === "bad") throw undefined; return path; },
    open: async path => { opened.push(path); },
  });
  expect(opened).toEqual(["good"]);
  expect(result).toEqual({ total: 2, completed: 2, opened: 1, cancelled: false, failures: [{ path: "bad", message: "undefined" }] });
});
