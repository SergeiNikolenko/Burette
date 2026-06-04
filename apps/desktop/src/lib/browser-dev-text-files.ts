import type { OpenTextFilesResult, TextFileDocument } from "../types";

export async function openBrowserDevTextFiles(paths: string[]): Promise<OpenTextFilesResult> {
  const documents: TextFileDocument[] = [];
  const errors: string[] = [];

  for (const path of paths) {
    try {
      documents.push(await readBrowserDevTextFile(path));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (documents.length === 0 && errors.length > 0) throw new Error(errors.join("; "));
  return { documents, errors };
}

async function readBrowserDevTextFile(path: string): Promise<TextFileDocument> {
  const response = await fetch(`/__burette/read-text-file?path=${encodeURIComponent(path)}`, {
    cache: "no-store",
  });
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
