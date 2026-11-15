import type { TextFileDocument } from "../types";
import { demoLibraryUrl } from "./web-demo-library";

// Published demo files have static URLs, not a browser-dev filesystem bridge.
export async function readWebDemoTextDocument(path: string, maxBytes?: number): Promise<TextFileDocument | null> {
  if (import.meta.env.VITE_BURETTE_WEB_DEMO !== "1") return null;
  const url = demoLibraryUrl(path);
  if (!url) return null;
  const response = await fetch(url, {
    headers: maxBytes === undefined ? undefined : { Range: `bytes=0-${Math.max(0, maxBytes - 1)}` },
  });
  if (!response.ok) throw new Error(`${path}: text file request failed with HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const totalBytes = Number(response.headers.get("content-range")?.match(/\/(\d+)$/u)?.[1]) || bytes.length;
  const contentBytes = maxBytes === undefined ? bytes : bytes.subarray(0, maxBytes);
  const title = path.split("/").pop() || path;
  const extension = title.includes(".") ? title.split(".").pop()?.toLowerCase() || "txt" : "txt";
  return {
    id: `web-demo-text-${path}`,
    path,
    title,
    extension,
    language: extension,
    content: new TextDecoder().decode(contentBytes),
    byteCount: totalBytes,
    truncated: contentBytes.length < totalBytes,
    modifiedAt: null,
  };
}
