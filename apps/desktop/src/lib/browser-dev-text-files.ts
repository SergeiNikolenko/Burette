import type { OpenTextFilesResult, TextFileDocument } from "../types";
import { readBrowserDevVirtualTextDocument } from "./browser-dev-documents";

const INLINE_IMAGE_BATCH_LIMIT = 48 * 1024 * 1024;

export async function openBrowserDevTextFiles(paths: string[]): Promise<OpenTextFilesResult> {
  const documents: TextFileDocument[] = [];
  const errors: string[] = [];
  let inlineImageBytes = 0;

  for (const path of paths) {
    try {
      const remainingImageBytes = Math.max(0, INLINE_IMAGE_BATCH_LIMIT - inlineImageBytes);
      const document = await readBrowserDevTextFile(path, remainingImageBytes);
      if (document.language === "image" && document.content) {
        if (inlineImageBytes + document.byteCount > INLINE_IMAGE_BATCH_LIMIT) {
          documents.push({ ...document, content: "", truncated: true });
          continue;
        }
        inlineImageBytes += document.byteCount;
      }
      documents.push(document);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (documents.length === 0 && errors.length > 0) throw new Error(errors.join("; "));
  return { documents, errors };
}

async function readBrowserDevTextFile(path: string, maxImageBytes: number): Promise<TextFileDocument> {
  const virtualText = readBrowserDevVirtualTextDocument(path);
  if (virtualText !== null) {
    const title = path.split("/").filter(Boolean).pop() || path;
    return {
      id: `web-demo-text-${path}`,
      path,
      title,
      extension: title.includes(".") ? title.split(".").pop()?.toLowerCase() || "txt" : "txt",
      language: "text",
      content: virtualText,
      byteCount: new TextEncoder().encode(virtualText).length,
      truncated: false,
      modifiedAt: null,
    };
  }
  const response = await fetch(
    `/__burette/read-text-file?path=${encodeURIComponent(path)}&maxImageBytes=${maxImageBytes}`,
    {
    cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(await browserDevTextFileError(response, path));
  }
  const document = await response.json() as TextFileDocument;
  if (!document || typeof document.path !== "string" || typeof document.content !== "string") {
    throw new Error(`${path}: invalid text file response`);
  }
  return document;
}

async function browserDevTextFileError(response: Response, path: string) {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  } catch (_) {
    // Fall through to the generic response status message.
  }
  return `${path}: text file request failed with HTTP ${response.status}`;
}
