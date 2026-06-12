import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri";

type TextFileReadResult = {
  id?: string;
  path?: string;
  title?: string;
  extension?: string;
  language?: string;
  byteCount?: number;
  content: string;
  truncated?: boolean;
  modifiedAt?: number | null;
};

type StructureTextReadOptions = {
  maxBytes?: number;
};

type StructureTextDocumentSeed = {
  id: string;
  path: string;
  title: string;
  extension: string;
  byteCount: number;
};

export async function readStructureText(path: string, options: StructureTextReadOptions = {}) {
  if (options.maxBytes !== undefined || isCompressedMaestroPath(path)) {
    const document = await readStructureTextDocument(path, undefined, options);
    return document.content;
  }
  if (isTauriRuntime()) {
    return invoke<string>("read_structure_text", { path });
  }
  const response = await fetch(`/__burette/read-file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.text();
}

export async function readStructureTextDocument(
  path: string,
  seed?: StructureTextDocumentSeed,
  options: StructureTextReadOptions = {},
) {
  const document = await readTextFileDocument(path, options.maxBytes);
  return normalizeTextDocument(document, seed, options.maxBytes);
}

async function readTextFileDocument(path: string, maxBytes?: number) {
  const query = maxBytes !== undefined ? `&maxBytes=${encodeURIComponent(String(maxBytes))}` : "";
  if (isCompressedMaestroPath(path)) {
    if (isTauriRuntime()) {
      return invoke<TextFileReadResult>("read_text_file", { path, maxBytes });
    }
    const response = await fetch(`/__burette/read-text-file?path=${encodeURIComponent(path)}${query}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json() as Promise<TextFileReadResult>;
  }
  if (isTauriRuntime()) {
    return invoke<TextFileReadResult>("read_text_file", { path, maxBytes });
  }
  const response = await fetch(`/__burette/read-text-file?path=${encodeURIComponent(path)}${query}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<TextFileReadResult>;
}

function normalizeTextDocument(document: TextFileReadResult, seed?: StructureTextDocumentSeed, maxBytes?: number) {
  const content = maxBytes !== undefined && document.content.length > maxBytes
    ? document.content.slice(0, maxBytes)
    : document.content;
  const cappedByClient = content.length < document.content.length;
  const resolvedPath = document.path ?? seed?.path ?? "";
  return {
    id: document.id ?? (seed ? `dock-text:${seed.id}` : `text:${pathHash(resolvedPath)}`),
    path: resolvedPath,
    title: document.title ?? seed?.title ?? "Text file",
    extension: document.extension ?? seed?.extension ?? "",
    language: document.language ?? document.extension ?? seed?.extension ?? "text",
    byteCount: document.byteCount ?? seed?.byteCount ?? content.length,
    content,
    truncated: Boolean(document.truncated || cappedByClient),
    modifiedAt: document.modifiedAt ?? null,
  };
}

function pathHash(path: string) {
  let hash = 0;
  for (let index = 0; index < path.length; index += 1) {
    hash = ((hash << 5) - hash + path.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function isCompressedMaestroPath(path: string) {
  const lowerPath = path.toLowerCase();
  return lowerPath.endsWith(".maegz") || lowerPath.endsWith(".mae.gz");
}
