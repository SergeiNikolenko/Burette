import type { DecodedText, DecodeOptions } from "./codecs";
import { formatMiB, MAX_DECODED_BYTES, type CompressionCodec } from "./formats";

export type CompressedRequest =
  | { action: "decode"; name: string; bytes: ArrayBuffer; options?: DecodeOptions }
  | { action: "encode"; codec: CompressionCodec; text: string };

type CompressedResults = { decode: DecodedText; encode: ArrayBuffer };

const TIME_LIMIT_MS = 60_000;

/**
 * Runs one decode or encode in its own worker. Aborting or running past the time
 * limit terminates the worker, which frees the decoder and everything it allocated.
 */
export function runCompressedTask<T extends CompressedRequest>(request: T, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CompressedResults[T["action"]]> {
  return new Promise((resolve, reject) => {
    const operation = request.action === "encode" ? "Compression" : "Decompression";
    if (options.signal?.aborted) { reject(new DOMException(`${operation} cancelled.`, "AbortError")); return; }
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException(`${operation} cancelled.`, "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${operation} exceeded the browser time limit.`)); }, options.timeoutMs ?? TIME_LIMIT_MS);
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || `${operation} worker failed.`)); };
    try {
      worker.postMessage(request, request.action === "decode" ? [request.bytes] : []);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Decodes a compressed file's bytes off the main thread. */
export async function decodeCompressedFile(name: string, file: Blob, options: DecodeOptions & { signal?: AbortSignal } = {}) {
  const { signal, ...decode } = options;
  if (signal?.aborted) throw new DOMException("Decompression cancelled.", "AbortError");
  if (file.size > MAX_DECODED_BYTES) throw new Error(`${name.split(/[\\/]/u).pop() || name} is larger than the ${formatMiB(MAX_DECODED_BYTES)} limit for compressed files`);
  let abortRead: (() => void) | undefined;
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    abortRead = () => reject(new DOMException("Decompression cancelled.", "AbortError"));
    signal?.addEventListener("abort", abortRead, { once: true });
    if (signal?.aborted) { abortRead(); return; }
    // The native read cannot be cancelled; ignore its late result after abort.
    file.arrayBuffer().then(resolve, reject);
  }).finally(() => { if (abortRead) signal?.removeEventListener("abort", abortRead); });
  return runCompressedTask({ action: "decode", name, bytes, options: decode }, { signal });
}

export async function encodeCompressedBlob(codec: CompressionCodec, text: string, options: { signal?: AbortSignal } = {}) {
  const bytes = await runCompressedTask({ action: "encode", codec, text }, options);
  return new Blob([bytes], { type: codec === "gzip" ? "application/gzip" : codec === "xz" ? "application/x-xz" : "application/zstd" });
}
