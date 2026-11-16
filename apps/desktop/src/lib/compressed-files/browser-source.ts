import { MAX_DECODED_BYTES, formatMiB } from "./formats";
import { checkCompressedFile, compressedSourceFor, registerCompressedSource } from "./sources";

const loading = new Map<string, Promise<void>>();

/** Read disk-backed compressed files through the same source adapter as browser imports. */
export async function loadBrowserCompressedSource(path: string, url: string) {
  if (compressedSourceFor(path)) return;
  const running = loading.get(path);
  if (running) return running;
  const promise = load(path, url).finally(() => {
    if (loading.get(path) === promise) loading.delete(path);
  });
  loading.set(path, promise);
  return promise;
}

async function load(path: string, url: string) {
  const name = path.split(/[\\/]/u).pop() || path;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`${name}: ${response.status} ${response.statusText}`);
    reader = response.body?.getReader();
    const tooLarge = () => new Error(`${name} is larger than the ${formatMiB(MAX_DECODED_BYTES)} browser limit for compressed files`);
    if (Number(response.headers.get("content-length")) > MAX_DECODED_BYTES) throw tooLarge();
    if (!reader) throw new Error(`${name} is empty`);
    const chunks: BlobPart[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DECODED_BYTES) throw tooLarge();
      chunks.push(value as BlobPart);
    }
    const file = new Blob(chunks);
    const format = await checkCompressedFile(name, file, MAX_DECODED_BYTES);
    // An upload may have replaced this path while the disk read was in flight.
    if (!compressedSourceFor(path)) registerCompressedSource(path, name, file, format);
  } finally {
    clearTimeout(timeout);
    await reader?.cancel().catch(() => {});
    controller.abort();
  }
}
