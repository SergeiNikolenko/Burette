import { useState } from "react";
import { Download } from "./ui/app-icons";
import { ToolbarButton } from "./ui/toolbar-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { downloadBlobFile, downloadTextFile } from "../lib/file-export";
import { readStructureText } from "../lib/structure-text";
import { useSourceEditing } from "../lib/source-editing/context";
import { useImportedOriginal } from "../lib/workbench/source";
import { useCompressedSource } from "../lib/compressed-files/sources";
import { encodeCompressedBlob } from "../lib/compressed-files/task";
import { toast } from "./ui/toast";
import type { ViewerDocument } from "../types";

export function BrowserStructureDownload({ file, document }: { file: { path: string; label: string }; document: ViewerDocument | null }) {
  const session = useSourceEditing()?.sessionForDocument(document);
  // A quantum output opens as generated, editable XYZ; the uploaded file stays downloadable as it was.
  const original = useImportedOriginal(document?.path === file.path ? document.id : null);
  // A compressed file opens as the text inside it; that text, a compressed copy of it and the file itself can be saved.
  const compressed = useCompressedSource(file.path);
  const [pending, setPending] = useState(false);
  const name = original && document ? document.title : file.path.split("/").pop() || "structure.xyz";
  const currentText = () => session && document?.path === file.path ? Promise.resolve(session.content) : readStructureText(file.path);
  const run = (save: () => Promise<void>) => {
    setPending(true);
    void save()
      .catch(error => toast.add({ title: "Could not download file", description: error instanceof Error ? error.message : String(error), type: "error" }))
      .finally(() => setPending(false));
  };
  const downloadCurrent = () => run(() => currentText().then(text => downloadTextFile(original ? name : compressed?.format.innerName ?? name, text)));
  const button = (onClick?: () => void) => <ToolbarButton disabled={pending} aria-label="Download file" onClick={onClick}><Download size={16} aria-hidden /></ToolbarButton>;
  if (compressed && !original) {
    const { format } = compressed;
    const exportName = format.exportName;
    return (
      <DropdownMenu>
        <ShortcutTooltip label="Download file"><DropdownMenuTrigger asChild>{button()}</DropdownMenuTrigger></ShortcutTooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={downloadCurrent}>Text · {format.innerName}</DropdownMenuItem>
          {exportName && <DropdownMenuItem onSelect={() => run(async () => downloadBlobFile(exportName, await encodeCompressedBlob(format.codec, await currentText())))}>Compressed · {exportName}</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => downloadBlobFile(compressed.name, compressed.file)}>Original · {compressed.name}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (!original) return <ShortcutTooltip label="Download file">{button(downloadCurrent)}</ShortcutTooltip>;
  return (
    <DropdownMenu>
      <ShortcutTooltip label="Download file"><DropdownMenuTrigger asChild>{button()}</DropdownMenuTrigger></ShortcutTooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={downloadCurrent}>Geometry · {name}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadBlobFile(original.name, original.file)}>Original · {original.name}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
