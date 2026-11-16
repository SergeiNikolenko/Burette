import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { loadBrowserCompressedSource } from "../apps/desktop/src/lib/compressed-files/browser-source";
import { MAX_DECODED_BYTES, supportedCompressedName } from "../apps/desktop/src/lib/compressed-files/formats";
import { assertCompressedSourceCurrent, checkCompressedFile, compressedSourceFor, decodeCompressedSource, registerCompressedSource } from "../apps/desktop/src/lib/compressed-files/sources";
import { decodeCompressedFile } from "../apps/desktop/src/lib/compressed-files/task";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/compressed/${name}`, import.meta.url)));
const sample = (name: string) => readFileSync(new URL(`../samples/${name}`, import.meta.url), "utf8");
const register = (path: string, file: Blob) => registerCompressedSource(path, path.split("/").pop()!, file, supportedCompressedName(path));
const gzip = (text: string) => new Blob([gzipSync(Buffer.from(text))]);

test("concurrent source reads share only equal budgets, and a settled job is released", async () => {
  for (const budgets of [[1024, 1], [1, 1024]]) {
    const path = `/OpenedFiles/budgets-${budgets[0]}.sdf.gz`;
    register(path, gzip("SOURCE_TEXT\n"));
    const first = decodeCompressedSource(path, budgets[0]);
    expect(decodeCompressedSource(path, budgets[0])).toBe(first);
    const other = decodeCompressedSource(path, budgets[1]);
    expect(other).not.toBe(first);
    const results = await Promise.allSettled([first, other]);
    expect(results.map(result => result.status === "fulfilled" ? result.value : String(result.reason).includes("expands beyond"))).toEqual(
      budgets.map(budget => budget === 1 ? true : "SOURCE_TEXT\n"),
    );
    const reopened = decodeCompressedSource(path, 1024);
    expect(reopened).not.toBe(first);
    expect(await reopened).toBe("SOURCE_TEXT\n");
  }
});

test("every supported codec reads through a real worker while Original stays byte exact", async () => {
  for (const [name, expected] of [
    ["mini.pdb.gz", "mini.pdb"], ["mini-members.pdb.gz", "mini.pdb"],
    ["caffeine.sdf.xz", "structures/small-molecules/caffeine.sdf"],
    ["mini-streams.xyz.xz", "mini.xyz"], ["mini.cif.zst", "mini.cif"], ["mini-frames.pdb.zst", "mini.pdb"],
  ]) {
    const bytes = fixture(name), file = new Blob([bytes as BlobPart]), path = `/OpenedFiles/worker-${name}`;
    const format = await checkCompressedFile(name, file, MAX_DECODED_BYTES);
    registerCompressedSource(path, name, file, format);
    expect(await decodeCompressedSource(path)).toBe(sample(expected));
    expect(compressedSourceFor(path)?.file).toBe(file);
    expect(new Uint8Array(await compressedSourceFor(path)!.file.arrayBuffer())).toEqual(bytes);
  }
  const path = "/OpenedFiles/bom.maegz", text = "\uFEFFMolecule\r\né\r\n", file = gzip(text);
  register(path, file);
  expect(await decodeCompressedSource(path)).toBe(text.slice(1));
  expect(await compressedSourceFor(path)!.file.arrayBuffer()).toEqual(await file.arrayBuffer());
  expect((await decodeCompressedFile("reads.pdb.bgzf", new Blob([fixture("mini-members.pdb.gz") as BlobPart]))).text).toBe(sample("mini.pdb"));
});

test("re-registering a source terminates every budget worker and invalidates the old generation", async () => {
  const NativeWorker = globalThis.Worker;
  const workers: Worker[] = [], terminated = new Set<Worker>();
  globalThis.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) { super(url, options); workers.push(this); }
    postMessage() {} // Hold the actual workers before decoding; replacement must terminate both.
    terminate() { terminated.add(this); return super.terminate(); }
  } as typeof Worker;
  const path = "/OpenedFiles/replacement.sdf.gz", file = gzip("FIRST\n");
  try {
    register(path, file);
    const old = compressedSourceFor(path)!;
    const pending = Promise.allSettled([decodeCompressedSource(path, 1), decodeCompressedSource(path, 1024)]);
    for (let attempt = 0; workers.length < 2 && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
    expect(workers.length).toBe(2);
    register(path, file); // Even the same Blob is a new registration generation.
    expect((await pending).map(result => result.status === "rejected" && String(result.reason).includes("was replaced"))).toEqual([true, true]);
    expect(terminated.size).toBe(2);
    expect(() => assertCompressedSourceCurrent(path, old)).toThrow("was replaced");
    expect(compressedSourceFor(path)?.file).toBe(file);
  } finally { globalThis.Worker = NativeWorker; workers.forEach(worker => worker.terminate()); }
  expect(await decodeCompressedSource(path)).toBe("FIRST\n");
});

test("disk-backed reads share one fetch and preserve uploaded replacements and size bounds", async () => {
  const nativeFetch = globalThis.fetch, bytes = fixture("caffeine.sdf.xz");
  let complete!: (response: Response) => void, calls = 0;
  globalThis.fetch = (() => { calls++; return new Promise<Response>(resolve => { complete = resolve; }); }) as unknown as typeof fetch;
  try {
    const path = "/authorized/disk.sdf.xz";
    const first = loadBrowserCompressedSource(path, "/read"), second = loadBrowserCompressedSource(path, "/read");
    complete(new Response(bytes as BodyInit));
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(await decodeCompressedSource(path)).toBe(sample("structures/small-molecules/caffeine.sdf"));
    expect(new Uint8Array(await compressedSourceFor(path)!.file.arrayBuffer())).toEqual(bytes);
    const replacementPath = "/authorized/replaced.sdf.gz", loading = loadBrowserCompressedSource(replacementPath, "/read");
    const upload = gzip("UPLOAD\n");
    register(replacementPath, upload);
    complete(new Response(gzipSync(Buffer.from("DISK\n"))));
    await loading;
    expect(compressedSourceFor(replacementPath)?.file).toBe(upload);
    expect(await decodeCompressedSource(replacementPath)).toBe("UPLOAD\n");
    const oversized = loadBrowserCompressedSource("/authorized/oversized.sdf.gz", "/read");
    complete(new Response(new Uint8Array(), { headers: { "Content-Length": String(MAX_DECODED_BYTES + 1) } }));
    await expect(oversized).rejects.toThrow("browser limit");
    expect(compressedSourceFor("/authorized/oversized.sdf.gz")).toBeNull();
  } finally { globalThis.fetch = nativeFetch; }
});
