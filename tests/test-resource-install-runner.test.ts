import { expect, test } from "bun:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { createResourceInstallRunner, type ResourceJob } from "../apps/desktop/src/lib/extensions/resource-install-runner";
import { CRYSTALS_RESOURCE } from "../apps/desktop/src/lib/extensions/resource-bundle";
import { createResourceStore } from "../apps/desktop/src/lib/extensions/resource-store";

const bytes = new Uint8Array(readFileSync(new URL("../resources/extensions/openchemistry-crystals.bin", import.meta.url)));
const prior = { ...CRYSTALS_RESOURCE, version: "previous" };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const response = (data = bytes) => new Response(data);
const reader = (read: () => Response | Promise<Response>) => (async () => read()) as typeof fetch;
const latest = (runner: ReturnType<typeof createResourceInstallRunner>) => runner.getSnapshot().jobs[0];

test("fixed asset streams actual byte progress, installs, refreshes through a new connection, then removes", async () => {
  const factory = new IDBFactory(), store = createResourceStore(factory), progress: number[] = [], phases: string[] = [];
  let requested = "", options: RequestInit | undefined;
  const fetcher = (async (url, init) => {
    requested = String(url); options = init;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 100)); controller.enqueue(bytes.slice(100, 200)); controller.enqueue(bytes.slice(200)); controller.close();
    } }), { headers: { "content-length": String(bytes.length) } });
  }) as typeof fetch;
  const runner = createResourceInstallRunner({ store, fetcher });
  runner.subscribe(() => {
    const job = latest(runner); if (!job) return;
    if (job.receivedBytes && progress.at(-1) !== job.receivedBytes) progress.push(job.receivedBytes);
    if (phases.at(-1) !== job.phase) phases.push(job.phase);
  });
  const pending = runner.installCrystals();
  expect(latest(runner).status).toBe("queued");
  const job = await pending;
  expect({ status: job.status, received: job.receivedBytes, total: job.totalBytes, cancelable: job.cancelable }).toEqual({ status: "success", received: bytes.length, total: bytes.length, cancelable: false });
  expect(requested.endsWith("/resources/extensions/openchemistry-crystals.bin")).toBe(true);
  expect(options).toMatchObject({ mode: "same-origin", redirect: "error", credentials: "same-origin", signal: expect.any(AbortSignal) });
  expect(progress).toEqual([100, 200, bytes.length]); expect(phases).toEqual(["reading", "installing"]);
  const reopened = createResourceInstallRunner({ store: createResourceStore(factory), fetcher });
  await reopened.refresh(); expect(reopened.getSnapshot().installed).toEqual(runner.getSnapshot().installed);
  expect(reopened.getSnapshot().installed!.files.length).toBe(526);
  expect((await runner.remove()).status).toBe("success");
  await reopened.refresh(); expect(reopened.getSnapshot().installed).toBeNull();
});

test("duplicate install shares the pending job, clear keeps it, and cancellation waits for reader cleanup before retry", async () => {
  const started = deferred(), cleaning = deferred(), cleaned = deferred(); let requests = 0;
  const runner = createResourceInstallRunner({ store: createResourceStore(new IDBFactory()), fetcher: reader(() => {
    requests++;
    if (requests > 1) return response();
    return new Response(new ReadableStream({ start() { started.resolve(); }, cancel() { cleaning.resolve(); return cleaned.promise; } }));
  }) });
  const pending = runner.installCrystals();
  expect(runner.installCrystals()).toBe(pending);
  await started.promise;
  runner.clearFinished(); expect(runner.getSnapshot().jobs.length).toBe(1);
  const id = latest(runner).id; runner.cancel(id); runner.cancel(id);
  await cleaning.promise;
  expect(latest(runner)).toMatchObject({ status: "running", cancelable: false });
  expect(runner.installCrystals()).toBe(pending); expect(requests).toBe(1);
  await expect(runner.remove()).rejects.toThrow("still running");
  cleaned.resolve(); expect((await pending).status).toBe("cancelled");
  expect((await runner.installCrystals()).status).toBe("success"); expect(requests).toBe(2);
});

test("cancel before execution never fetches, and failed history remains bounded", async () => {
  let requests = 0;
  const runner = createResourceInstallRunner({ store: createResourceStore(new IDBFactory()), fetcher: reader(() => { requests++; return new Response("error", { status: 503 }); }) });
  const first = runner.installCrystals(); runner.cancel(latest(runner).id);
  expect((await first).status).toBe("cancelled"); expect(requests).toBe(0);
  for (let i = 0; i < 22; i++) expect((await runner.installCrystals()).status).toBe("failed");
  expect(runner.getSnapshot().jobs.length).toBe(20);
  runner.clearFinished(); expect(runner.getSnapshot().jobs).toEqual([]);
});

test("length, streaming overflow, truncation, SHA and network failures preserve the prior installation", async () => {
  const store = createResourceStore(new IDBFactory());
  const previous = await store.install(prior, bytes);
  const corrupt = bytes.slice(); corrupt[40] ^= 1;
  const cases = [() => new Response(bytes, { headers: { "content-length": String(bytes.length + 1) } }),
    () => response(new Uint8Array(bytes.length + 1)), () => response(bytes.slice(0, -1)), () => response(corrupt),
    () => { throw new Error("Secret diagnostics must not reach the job row".repeat(100)); }];
  for (const failure of cases) {
    const runner = createResourceInstallRunner({ store, fetcher: reader(failure) }); await runner.refresh();
    const job = await runner.installCrystals();
    expect({ status: job.status, error: job.error }).toEqual({ status: "failed", error: "Crystals could not be installed. Try again." });
    expect(runner.getSnapshot().installed).toEqual(previous);
    expect(await store.getInstalled(prior.id)).toEqual(previous);
  }
});

test("cancellation in fetch propagates its signal and stops the job", async () => {
  const entered = deferred(); let acceptedSignal: AbortSignal | undefined;
  const runner = createResourceInstallRunner({ store: createResourceStore(new IDBFactory()), fetcher: (async (_url, options) => {
    acceptedSignal = options!.signal as AbortSignal; entered.resolve();
    return new Promise<Response>((_resolve, reject) => acceptedSignal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
  }) as typeof fetch });
  const pending = runner.installCrystals(); await entered.promise; runner.cancel(latest(runner).id);
  expect((await pending).status).toBe("cancelled"); expect(acceptedSignal!.aborted).toBe(true);
});

for (const fault of ["quota", "cancel"]) test(`${fault} at IDB publication preserves current installation and retry succeeds`, async () => {
  const store = createResourceStore(new IDBFactory()), previous = await store.install(prior, bytes);
  const runner = createResourceInstallRunner({ store, fetcher: reader(() => response()) }); await runner.refresh();
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === "versions" && fault === "quota") throw new DOMException("Full", "QuotaExceededError");
    const result = put.apply(this, args);
    if (this.name === "versions" && fault === "cancel") runner.cancel(latest(runner).id);
    return result;
  };
  let job: ResourceJob;
  try { job = await runner.installCrystals(); } finally { IDBObjectStore.prototype.put = put; }
  expect(job!.status).toBe(fault === "quota" ? "failed" : "cancelled");
  if (fault === "quota") expect(job!.error).toBe("Not enough storage. Free some space and retry.");
  expect(runner.getSnapshot().installed).toEqual(previous); expect(await store.getInstalled(prior.id)).toEqual(previous);
  expect((await runner.installCrystals()).status).toBe("success");
});

test("late cancellation after commit stays successful, including removal and synchronous clearing of finished jobs", async () => {
  const store = createResourceStore(new IDBFactory());
  const runner = createResourceInstallRunner({ store: { ...store,
    async install(...args) { const installed = await store.install(...args); runner.cancel(latest(runner).id); return installed; },
    async remove(...args) { await store.remove(...args); runner.cancel(latest(runner).id); },
  }, fetcher: reader(() => response()) });
  runner.subscribe(() => { if (latest(runner)?.status === "success") runner.clearFinished(); });
  expect((await runner.installCrystals()).status).toBe("success");
  expect(runner.getSnapshot().installed!.files.length).toBe(526);
  expect((await runner.remove()).status).toBe("success"); expect(runner.getSnapshot().installed).toBeNull();
  expect(await store.getInstalled(CRYSTALS_RESOURCE.id)).toBeNull();
});

test("cancelled removal preserves the installed bundle and permits a later removal", async () => {
  const store = createResourceStore(new IDBFactory()), previous = await store.install(prior, bytes);
  const runner = createResourceInstallRunner({ store, fetcher: reader(() => response()) }); await runner.refresh();
  const erase = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (...args) {
    const request = erase.apply(this, args);
    if (this.name === "resources") runner.cancel(latest(runner).id);
    return request;
  };
  try { expect((await runner.remove()).status).toBe("cancelled"); }
  finally { IDBObjectStore.prototype.delete = erase; }
  expect(runner.getSnapshot().installed).toEqual(previous);
  expect(await store.getInstalled(prior.id)).toEqual(previous);
  expect((await runner.remove()).status).toBe("success");
  expect(runner.getSnapshot().installed).toBeNull();
});

test("stale refresh cannot restore removed data or overwrite a newer refresh; refresh failures preserve prior state", async () => {
  const store = createResourceStore(new IDBFactory()), installed = await store.install(prior, bytes);
  const old = deferred<typeof installed | null>(); let reads = 0;
  const runner = createResourceInstallRunner({ store: { ...store, getInstalled: () => ++reads === 1 ? old.promise : store.getInstalled(prior.id) }, fetcher: reader(() => response()) });
  const pending = runner.refresh(); await runner.remove(); old.resolve(installed); await pending;
  expect(runner.getSnapshot().installed).toBeNull();
  await runner.installCrystals();
  const actual = runner.getSnapshot().installed;
  const stale = deferred<typeof installed | null>(); let fail = false;
  const other = createResourceInstallRunner({ store: { ...store, getInstalled: () => {
    if (fail) throw new Error("storage unavailable"); return ++reads === 3 ? stale.promise : store.getInstalled(prior.id);
  } }, fetcher: reader(() => response()) });
  reads = 2; const older = other.refresh(); await other.refresh(); stale.resolve(null); await older;
  expect(other.getSnapshot().installed).toEqual(actual);
  fail = true; await other.refresh(); expect(other.getSnapshot().installed).toEqual(actual);
  expect(other.getSnapshot().error).toBe("Installed extensions could not be read. Retry.");
});

test("terminal reconciliation cannot hold singleflight while a stored read is delayed", async () => {
  const store = createResourceStore(new IDBFactory()), read = deferred<null>();
  const runner = createResourceInstallRunner({ store: { ...store, getInstalled: () => read.promise }, fetcher: reader(() => new Response("failed", { status: 503 })) });
  const first = runner.installCrystals(); expect((await first).status).toBe("failed");
  const next = runner.installCrystals(); expect(next).not.toBe(first); expect((await next).status).toBe("failed");
  expect(runner.getSnapshot().jobs.length).toBe(2);
  read.resolve(null); await runner.refresh(); expect(runner.getSnapshot().initialized).toBe(true);
});
