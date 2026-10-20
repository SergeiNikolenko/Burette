import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { fetchStructureText } from "../apps/desktop/src/lib/structure-download";
import { fetchRemoteStructure } from "../apps/desktop/src/lib/remote-structure";

mock.module("../apps/desktop/src/lib/web-demo-workspace", () => ({ pickWebDemoFiles: mock() }));
const { fetchBrowserDevPdbStructure } = await import("../apps/desktop/src/hooks/use-app-open-actions");
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const restore: Array<() => void> = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  for (const undo of restore.splice(0)) undo();
});
const small = { maxBytes: 8, timeoutMs: 500, httpError: (r: Response) => `HTTP ${r.status}` };
const url = "https://structures.example/mini.xyz";
const encoder = new TextEncoder();

function streamResponse(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let reads = 0;
  const cancel = mock(() => {});
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads < chunks.length) controller.enqueue(chunks[reads++]);
      else controller.close();
    }, cancel,
  }, { highWaterMark: 0 });
  return { response: new Response(body, { headers }), cancel, reads: () => reads };
}

test("remote result preserves split UTF-8, BOM decoding, title, extension and byte count", async () => {
  const bytes = encoder.encode("\uFEFF🧪α\n");
  const fixture = streamResponse(Array.from(bytes, (b) => Uint8Array.of(b)));
  const fetcher = mock(async () => fixture.response);
  globalThis.fetch = fetcher as typeof fetch;
  expect(await fetchRemoteStructure(url)).toEqual({ url, title: "mini.xyz", extension: "xyz", text: "🧪α\n", byteCount: 7 });
  expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
});

test("exact byte limit succeeds; absent and misleading lengths cannot hide overflow", async () => {
  for (const headers of [{}, { "content-length": "1" }, { "content-length": "2", "content-encoding": "gzip" }]) {
    const fixture = streamResponse([encoder.encode("12345678"), encoder.encode("9"), encoder.encode("unread")], headers);
    let signal!: AbortSignal;
    globalThis.fetch = mock(async (_url, options) => { signal = options.signal; return fixture.response; }) as typeof fetch;
    await expect(fetchStructureText(url, small)).rejects.toThrow("too large");
    expect(fixture.reads()).toBe(2);
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);
  }
  globalThis.fetch = mock(async () => streamResponse([encoder.encode("12345678")]).response) as typeof fetch;
  expect(await fetchStructureText(url, small)).toEqual({ text: "12345678", byteCount: 8 });
});

test("declared overflow cancels without reading; malformed UTF-8 decoded size is also bounded", async () => {
  const fixture = streamResponse([encoder.encode("unread")], { "content-length": "999" });
  globalThis.fetch = mock(async () => fixture.response) as typeof fetch;
  await expect(fetchStructureText(url, small)).rejects.toThrow("too large");
  expect(fixture.reads()).toBe(0);
  expect(fixture.cancel).toHaveBeenCalledTimes(1);
  globalThis.fetch = mock(async () => streamResponse([Uint8Array.of(255, 255, 255)]).response) as typeof fetch;
  await expect(fetchStructureText(url, small)).rejects.toThrow("too large");
  globalThis.fetch = mock(async () => streamResponse([Uint8Array.of(255)]).response) as typeof fetch;
  expect(await fetchStructureText(url, small)).toEqual({ text: "�", byteCount: 3 });
});

test("one deadline aborts stalled headers even if the fetch promise does not settle", async () => {
  let signal!: AbortSignal;
  globalThis.fetch = mock((_url, options) => { signal = options.signal; return new Promise(() => {}); }) as typeof fetch;
  await expect(fetchStructureText(url, { ...small, timeoutMs: 15 })).rejects.toThrow("timed out");
  expect(signal.aborted).toBe(true);
});

test("body deadline cancels transport without awaiting stalled cancellation cleanup", async () => {
  const cancel = mock(() => new Promise<void>(() => {}));
  let signal!: AbortSignal;
  const response = new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel }));
  globalThis.fetch = mock(async (_url, options) => { signal = options.signal; return response; }) as typeof fetch;
  await expect(fetchStructureText(url, { ...small, timeoutMs: 15 })).rejects.toThrow("timed out");
  expect(signal.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
});

test("many small chunks do not retain one abort listener per chunk", async () => {
  const originalAdd = AbortSignal.prototype.addEventListener;
  const originalRemove = AbortSignal.prototype.removeEventListener;
  let active = 0;
  let peak = 0;
  const add = spyOn(AbortSignal.prototype, "addEventListener").mockImplementation(function (...args) {
    active++; peak = Math.max(peak, active); return originalAdd.apply(this, args);
  });
  const remove = spyOn(AbortSignal.prototype, "removeEventListener").mockImplementation(function (...args) {
    active--; return originalRemove.apply(this, args);
  });
  restore.push(() => add.mockRestore(), () => remove.mockRestore());
  globalThis.fetch = mock(async () => streamResponse(Array(10000).fill(Uint8Array.of(65))).response) as typeof fetch;
  expect((await fetchStructureText(url, { ...small, maxBytes: 10000, timeoutMs: 5000 })).byteCount).toBe(10000);
  await Promise.resolve();
  expect(peak).toBeLessThanOrEqual(2);
  expect(active).toBe(0);
});

test("both browser entry points keep HTTP and empty-body errors", async () => {
  globalThis.fetch = mock(async () => new Response("denied", { status: 403, statusText: "Forbidden" })) as typeof fetch;
  await expect(fetchRemoteStructure(url)).rejects.toThrow("Fetch failed with HTTP 403");
  await expect(fetchBrowserDevPdbStructure("1ABC")).rejects.toThrow("RCSB PDB returned 403 Forbidden");
  globalThis.fetch = mock(async () => new Response("  ")) as typeof fetch;
  await expect(fetchRemoteStructure(url)).rejects.toThrow("Fetched structure is empty");
  await expect(fetchBrowserDevPdbStructure("1ABC")).rejects.toThrow("RCSB PDB returned an empty structure");
});

test("URL and PDB callers use their distinct 10 MiB and 75 MiB allowances", async () => {
  globalThis.fetch = mock(async () => streamResponse([encoder.encode("ATOM\n")], { "content-length": String(60 * 1024 * 1024) }).response) as typeof fetch;
  await expect(fetchRemoteStructure(url)).rejects.toThrow("too large");
  expect(await fetchBrowserDevPdbStructure("1ABC")).toEqual({ title: "1ABC.pdb", extension: "pdb", text: "ATOM\n" });
  globalThis.fetch = mock(async () => streamResponse([], { "content-length": String(75 * 1024 * 1024 + 1) }).response) as typeof fetch;
  await expect(fetchBrowserDevPdbStructure("1ABC")).rejects.toThrow("too large");
});

test("native URL entry point continues to invoke the bounded native command", async () => {
  const invoke = mock(async () => ({ text: "native" }));
  globalThis.window = { __TAURI_INTERNALS__: { invoke } } as never;
  const fetcher = mock();
  globalThis.fetch = fetcher as typeof fetch;
  expect(await fetchRemoteStructure(url)).toEqual({ text: "native" });
  expect(invoke).toHaveBeenCalledWith("fetch_remote_structure", { request: { url } }, undefined);
  expect(fetcher).not.toHaveBeenCalled();
});
