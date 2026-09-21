import { invoke } from "@tauri-apps/api/core";
import { pathExtension, structureExtensions } from "./file-routing";
import { isTauriRuntime } from "./tauri";

const MAX_REMOTE_STRUCTURE_BYTES = 10 * 1024 * 1024;

export type RemoteStructureResult = {
  url: string;
  title: string;
  extension: string;
  text: string;
  byteCount: number;
};

export function isRemoteStructureUrl(value: string) {
  const parsed = parseRemoteStructureUrl(value);
  return Boolean(parsed && remoteStructureExtension(parsed));
}

export async function fetchRemoteStructure(url: string): Promise<RemoteStructureResult> {
  const parsed = parseRemoteStructureUrl(url);
  if (!parsed) throw new Error("Structure URL must start with http:// or https://");
  const title = remoteStructureTitle(parsed);
  const extension = remoteStructureExtension(parsed);
  if (!extension) throw new Error("Remote structure URL must include a supported file extension");
  if (isTauriRuntime()) {
    return invoke<RemoteStructureResult>("fetch_remote_structure", { request: { url: parsed.toString() } });
  }
  const response = await fetch(parsed.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error(`Fetch failed with HTTP ${response.status}`);
  const text = await response.text();
  const byteCount = new TextEncoder().encode(text).length;
  if (byteCount > MAX_REMOTE_STRUCTURE_BYTES) throw new Error("Fetched structure is too large");
  if (!text.trim()) throw new Error("Fetched structure is empty");
  return { url: parsed.toString(), title, extension, text, byteCount };
}

function parseRemoteStructureUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function remoteStructureTitle(url: URL) {
  return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "remote-structure.pdb");
}

function remoteStructureExtension(url: URL) {
  const extension = pathExtension(remoteStructureTitle(url));
  return structureExtensions.has(extension) ? extension : "";
}
