import { invoke } from "@tauri-apps/api/core";
import type { ViewerDocument } from "../../types";
import { readBrowserDevVirtualTextDocument } from "../browser-dev-documents";
import { readBrowserImport } from "../browser-import-storage";
import { isExplicitBrowserDevServerPath } from "../browser-dev-paths";
import { isTauriRuntime } from "../tauri";
import { compressedSourceFor } from "../compressed-files/sources";
import { ScienceSessionError, SCIENCE_SESSION_LIMITS } from "./contracts";

/** Exact opened bytes, shared by archive restore and Original graph-source capture. */
export async function readSceneDocumentBytes(document: ViewerDocument, maxBytes: number = SCIENCE_SESSION_LIMITS.archiveBytes) {
  const bounded = (bytes: Uint8Array) => { if (bytes.byteLength > maxBytes) throw new ScienceSessionError("limit", "The scene source exceeds its byte limit."); return bytes; };
  if (document.byteCount > maxBytes) throw new ScienceSessionError("limit", "The scene source exceeds its byte limit.");
  if (isTauriRuntime()) return bounded(new Uint8Array(await invoke<ArrayBuffer>("read_document_file", { path: document.path })));
  const registered = compressedSourceFor(document.path)?.file;
  const original = registered ?? (!isExplicitBrowserDevServerPath(document.path) ? (await readBrowserImport(document.path))?.file : null);
  if (original) {
    if (original.size > maxBytes) throw new ScienceSessionError("limit", "The scene source exceeds its byte limit.");
    return bounded(new Uint8Array(await original.arrayBuffer()));
  }
  const virtual = readBrowserDevVirtualTextDocument(document.path);
  if (virtual !== null) return bounded(new TextEncoder().encode(virtual));
  const response = await fetch(`/__burette/read-file?path=${encodeURIComponent(document.path)}`, { cache: "no-store" });
  if (!response.ok) throw new ScienceSessionError("archive", "Could not read the scene source. Try opening it again.");
  const reader = response.body?.getReader();
  if (!reader) throw new ScienceSessionError("archive", "Could not read the scene source. Try opening it again.");
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > maxBytes) throw new ScienceSessionError("limit", "The scene source exceeds its byte limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
