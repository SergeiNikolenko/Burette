import { useSyncExternalStore } from "react";
import { assertSignatureMatches, formatMiB, MAX_DECODED_BYTES, supportedCompressedName, type CompressedName } from "./formats";
import { decodeCompressedFile } from "./task";

/**
 * Compressed files opened in the browser, by the workspace path their document
 * opens at. The path keeps the compressed name (`/OpenedFiles/1abc.pdb.gz`), so
 * the document is never confused with an uncompressed file of the same name;
 * its text is the decoded file, an ordinary editable draft. The uploaded bytes
 * stay here unchanged for "Original" downloads.
 */
export type CompressedSource = { name: string; file: Blob; format: CompressedName };

const sources = new Map<string, CompressedSource>();
type DecodeJob = { source: CompressedSource; controller: AbortController; promise: Promise<string> };
const decoding = new Map<string, Map<number, DecodeJob>>();
const listeners = new Set<() => void>();

function changed() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Checks the name, size and first bytes of a compressed file before it is registered. */
export async function checkCompressedFile(name: string, file: Blob, maxInputBytes: number) {
  const format = supportedCompressedName(name);
  if (file.size > maxInputBytes) throw new Error(`larger than the ${formatMiB(maxInputBytes)} browser limit for compressed files`);
  assertSignatureMatches(name, new Uint8Array(await file.slice(0, 6).arrayBuffer()), format.codec);
  return format;
}

/** Registers `file` as the compressed source of `path`; a decode still running for an earlier file there is cancelled. */
export function registerCompressedSource(path: string, name: string, file: Blob, format: CompressedName) {
  decoding.get(path)?.forEach(job => job.controller.abort());
  decoding.delete(path);
  sources.set(path, { name, file, format });
  changed();
}

export function compressedSourceFor(path: string) {
  return sources.get(path) ?? null;
}

function replacedError(source: CompressedSource) {
  return new Error(`${source.name} was replaced while it was opening`);
}

/** Throws unless `source` is still the file registered at `path`. */
export function assertCompressedSourceCurrent(path: string, source: CompressedSource) {
  if (sources.get(path) !== source) throw replacedError(source);
}

export function useCompressedSource(path: string | null) {
  return useSyncExternalStore(subscribe, () => (path ? sources.get(path) ?? null : null));
}

/**
 * Decoded text of the compressed file registered at `path`. Concurrent opens of
 * the same file and byte budget share one decode; a result for a file that has since been
 * replaced at that path is never returned.
 */
export function decodeCompressedSource(path: string, maxBytes = MAX_DECODED_BYTES): Promise<string> {
  const source = sources.get(path);
  if (!source) return Promise.reject(new Error(`${path} is not a compressed file`));
  const jobs = decoding.get(path) ?? new Map<number, DecodeJob>();
  const running = jobs.get(maxBytes);
  if (running?.source === source) return running.promise;
  const controller = new AbortController();
  const promise = decodeCompressedFile(source.name, source.file, { maxBytes, signal: controller.signal })
    .then(({ text }) => {
      assertCompressedSourceCurrent(path, source);
      return text;
    }, (error) => {
      throw controller.signal.aborted ? replacedError(source) : error;
    })
    .finally(() => {
      if (jobs.get(maxBytes)?.promise === promise) jobs.delete(maxBytes);
      if (!jobs.size && decoding.get(path) === jobs) decoding.delete(path);
    });
  jobs.set(maxBytes, { source, controller, promise });
  decoding.set(path, jobs);
  return promise;
}
