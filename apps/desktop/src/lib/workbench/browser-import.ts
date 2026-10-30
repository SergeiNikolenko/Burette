import type { ViewerDocument, ViewerPreferences } from "../../types";
import { readBrowserImport } from "../browser-import-storage";
import { isExplicitBrowserDevServerPath } from "../browser-dev-paths";
import { deleteBrowserDevVirtualTextDocument, openBrowserDevTextDocument, writeBrowserDevVirtualTextDocument } from "../browser-dev-documents";
import { openScientificFiles } from "./open";
import { isScientificFile } from "./scientific-files";

/** Reparse a durable original on every fresh open; its generated geometry keeps the durable tab path. */
export async function openStoredScientificFile(path: string, preferences: ViewerPreferences,
  adopt: (document: ViewerDocument) => void, shouldApply: () => boolean): Promise<ViewerDocument[] | null> {
  if (!shouldApply()) return [];
  if (isExplicitBrowserDevServerPath(path)) return null;
  const original = await readBrowserImport(path);
  if (!shouldApply()) return [];
  if (!original) return null;
  const file = new File([original.file], original.name, { type: original.file.type });
  if (!original.scientific && !await isScientificFile(file)) return null;
  const opened: ViewerDocument[] = [];
  if (!shouldApply()) return opened;
  await openScientificFiles({ openStructureRecords: async (records) => {
    if (!shouldApply()) return [];
    for (const record of records) {
      const generated = await openBrowserDevTextDocument(record.path, record.inputExtension, record.text, preferences);
      try {
        if (!shouldApply()) return [];
        // The viewer embeds the XYZ bytes. The host reads geometry at the durable
        // path while Original remains the byte-identical Blob in IndexedDB.
        writeBrowserDevVirtualTextDocument(path, record.text);
        const document = { ...generated, path };
        adopt(document);
        opened.push(document);
      } finally {
        if (generated.path !== path) deleteBrowserDevVirtualTextDocument(generated.path);
      }
    }
    return opened;
  } }, [file]);
  return opened;
}
