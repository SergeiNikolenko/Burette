import type { ViewerDocument, ViewerPreferences } from "../../types";
import { readBrowserImport } from "../browser-import-storage";
import { isExplicitBrowserDevServerPath } from "../browser-dev-paths";
import { deleteBrowserDevVirtualTextDocument, openBrowserDevTextDocument, writeBrowserDevVirtualTextDocument } from "../browser-dev-documents";
import { openScientificFiles } from "./open";
import { isScientificFile } from "./scientific-files";
import { readBrowserSourceRecord } from "../browser-source-storage";
import { adoptRestoredScientificSource } from "./scientific-source-state";
import { readServerScientificFile } from "./server-scientific-file";

/** Reopen a verified clean attachment or reparse the durable Original at its stable tab path. */
export async function openStoredScientificFile(path: string, preferences: ViewerPreferences,
  adopt: (document: ViewerDocument) => void, shouldApply: () => boolean): Promise<ViewerDocument[] | null> {
  if (!shouldApply()) return [];
  let file: File;
  if (isExplicitBrowserDevServerPath(path)) {
    const selected = await readServerScientificFile(path, shouldApply);
    if (!shouldApply()) return [];
    if (!selected) return null;
    file = selected;
  } else {
    const original = await readBrowserImport(path);
    if (!shouldApply()) return [];
    if (!original) return null;
    const attachment = await readBrowserSourceRecord("scientific-attachments", path);
    if (!shouldApply()) return [];
    if (attachment) {
      const generated = await openBrowserDevTextDocument(attachment.title, "xyz", attachment.text, preferences);
      try {
        if (!shouldApply()) return [];
        const document = { ...generated, path };
        writeBrowserDevVirtualTextDocument(path, attachment.text);
        adoptRestoredScientificSource(document.id, { text: attachment.text, document: attachment.science }, { name: original.name, file: original.file }, attachment.companions);
        adopt(document);
        return [document];
      } finally { if (generated.path !== path) deleteBrowserDevVirtualTextDocument(generated.path); }
    }
    file = new File([original.file], original.name, { type: original.file.type });
    if (!original.scientific && !await isScientificFile(file)) return null;
  }
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
