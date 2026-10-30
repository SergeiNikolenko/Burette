import { isExplicitBrowserDevServerPath } from "../browser-dev-paths";
import { isScientificFile, mayBeScientificFile, SCIENTIFIC_FILE_LIMIT } from "./scientific-files";

/** Read only an explicitly selected local server path, through its existing authorization gate. */
export async function readServerScientificFile(path: string, isCurrent: () => boolean): Promise<File | null> {
  if (!isCurrent() || !path.startsWith("/") || !isExplicitBrowserDevServerPath(path)) return null;
  const name = path.split("/").at(-1) ?? "";
  if (!mayBeScientificFile(name)) return null;
  const url = "/@fs" + path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(url, { cache: "no-store", mode: "same-origin", redirect: "error" });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The scientific file could not be read.");
  try {
    if (!isCurrent()) return null;
    if (!response.ok) throw new Error("The scientific file could not be read.");
    const limit = SCIENTIFIC_FILE_LIMIT;
    const declaredOversized = Number(response.headers.get("content-length")) > limit;
    // Large ordinary logs/JSON retain their existing text route. Scientific output
    // recognition inspects only this prefix; never retain an oversized response.
    const readLimit = declaredOversized ? 64 * 1024 : limit;
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (!isCurrent()) return null;
      if (done) break;
      if (value.byteLength > readLimit - size) {
        parts.push(new Uint8Array(value.subarray(0, readLimit - size)));
        const recognized = await isScientificFile(new File(parts, name));
        if (!isCurrent()) return null;
        if (recognized) throw new Error("Quantum outputs can be at most 16 MiB.");
        return null;
      }
      size += value.byteLength;
      parts.push(new Uint8Array(value));
    }
    const file = new File(parts, name);
    if (!await isScientificFile(file) || !isCurrent()) return null;
    if (declaredOversized) throw new Error("Quantum outputs can be at most 16 MiB.");
    return file;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
