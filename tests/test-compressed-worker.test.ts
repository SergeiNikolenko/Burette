import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MAX_DECODED_BYTES } from "../apps/desktop/src/lib/compressed-files/formats";
import { decodeCompressedFile, encodeCompressedBlob, runCompressedTask } from "../apps/desktop/src/lib/compressed-files/task";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/compressed/${name}`, import.meta.url)));

test("the actual compression transport cancels, times out, reports decode failures and remains usable", async () => {
  const bytes = () => fixture("mini.pdb.gz").buffer as ArrayBuffer;
  const controller = new AbortController();
  const pending = runCompressedTask({ action: "decode", name: "mini.pdb.gz", bytes: bytes() }, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(runCompressedTask({ action: "decode", name: "mini.pdb.gz", bytes: bytes() }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  await expect(runCompressedTask({ action: "decode", name: "mini.pdb.gz", bytes: bytes() }, { timeoutMs: 0 })).rejects.toThrow("time limit");
  await expect(decodeCompressedFile("bad.sdf.xz", new Blob([fixture("caffeine.sdf.xz").subarray(0, 30) as BlobPart]))).rejects.toThrow("truncated");
  for (const codec of ["gzip", "xz", "zstd"] as const) {
    const text = "Molecule\r\né\r\n", encoded = await encodeCompressedBlob(codec, text);
    expect((await decodeCompressedFile(`copy.sdf.${codec === "gzip" ? "gz" : codec === "xz" ? "xz" : "zst"}`, encoded)).text).toBe(text);
  }
});

// These sentinels exercise the inclusive metadata guard without a large allocation.
// Accepted input still comes from a real immutable Blob and the real decoder worker.
class MetadataBlob extends Blob {
  reads = 0;
  constructor(private readonly declaredBytes: number) { super([fixture("mini.pdb.gz") as BlobPart]); }
  override get size() { return this.declaredBytes; }
  override arrayBuffer() { this.reads++; return super.arrayBuffer(); }
}

test("a pre-aborted compressed read never calls Blob.arrayBuffer", async () => {
  const source = new MetadataBlob(1024), controller = new AbortController();
  controller.abort();
  await expect(decodeCompressedFile("mini.pdb.gz", source, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(source.reads).toBe(0);
});

test("input above the existing 64 MiB cap is refused before Blob.arrayBuffer", async () => {
  const source = new MetadataBlob(MAX_DECODED_BYTES + 1);
  await expect(decodeCompressedFile("mini.pdb.gz", source)).rejects.toThrow("larger than the 64 MiB limit for compressed files");
  expect(source.reads).toBe(0);
});

test("input metadata exactly at the existing cap proceeds to a valid real worker decode", async () => {
  const source = new MetadataBlob(MAX_DECODED_BYTES);
  expect((await decodeCompressedFile("mini.pdb.gz", source)).text).toBe(readFileSync(new URL("../samples/mini.pdb", import.meta.url), "utf8"));
  expect(source.reads).toBe(1);
});

test("abort during a held Blob read rejects promptly and late completion starts no worker", async () => {
  const NativeWorker = globalThis.Worker;
  let workers = 0, reads = 0, release!: () => void, began!: () => void, returned!: Promise<ArrayBuffer>;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  const source = new class extends Blob {
    override arrayBuffer() {
      reads++;
      returned = Promise.all([super.arrayBuffer(), gate]).then(([bytes]) => bytes);
      began();
      return returned;
    }
  }([fixture("mini.pdb.gz") as BlobPart]);
  globalThis.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) { workers++; super(url, options); }
  } as typeof Worker;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = decodeCompressedFile("mini.pdb.gz", source, { signal: controller.signal }).then(() => "resolved", error => error.name);
    await started;
    controller.abort();
    const stalled = new Promise<string>(resolve => { timer = setTimeout(() => resolve("still reading"), 100); });
    expect(await Promise.race([result, stalled])).toBe("AbortError");
    expect(reads).toBe(1);
    expect(workers).toBe(0);
    release();
    await returned;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(workers).toBe(0);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    release();
    await returned;
    globalThis.Worker = NativeWorker;
  }
});
