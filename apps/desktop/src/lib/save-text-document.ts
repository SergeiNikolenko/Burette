import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri";
import { readStructureTextDocument } from "./structure-text";

export type SavedTextDocument = {
  byteCount: number;
  modifiedAt: number | null;
};

export async function saveTextDocument(
  path: string,
  contents: string,
  expectedModifiedAt: number | null,
): Promise<SavedTextDocument> {
  if (isTauriRuntime()) {
    const current = await readStructureTextDocument(path, undefined, { maxBytes: 1 });
    if (expectedModifiedAt !== null && current.modifiedAt !== null && current.modifiedAt !== expectedModifiedAt) {
      throw new Error("The file changed on disk. Reopen it before saving your edits.");
    }
    await invoke<string>("write_text_file", {
      request: { outputPath: path, contents },
    });
    const saved = await readStructureTextDocument(path, undefined, { maxBytes: 1 });
    return { byteCount: saved.byteCount, modifiedAt: saved.modifiedAt };
  }

  const response = await fetch(`/__burette/write-text-file?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, expectedModifiedAt }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof payload?.error === "string" ? payload.error : `Save failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<SavedTextDocument>;
}
