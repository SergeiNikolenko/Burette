import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { downloadBase64File, downloadTextFile, exportDialogFilters, safeExportFileName } from "../lib/file-export";
import { basename } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import type { PostMessageToViewerSource } from "../lib/viewer-bridge";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;
type ViewerFileMessageBody = Record<string, unknown> | null | undefined;

type UseAppViewerFileActionsOptions = {
  postMessageToViewerSource: PostMessageToViewerSource;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
};

function bodyString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

export function useAppViewerFileActions({
  postMessageToViewerSource,
  pushErrorStatus,
  pushStatus,
}: UseAppViewerFileActionsOptions) {
  const handleViewerFileMessage = useCallback((body: ViewerFileMessageBody, source: MessageEventSource | null) => {
    if (body?.type === "exportText") {
      const text = typeof body.text === "string" ? body.text : "";
      const name = safeExportFileName(bodyString(body.name, "molstar-export.cif"));
      const reply = (status: "saved" | "cancelled" | "error") => {
        if (typeof body.requestId !== "string") return;
        postMessageToViewerSource(source, {
          source: "burette-host",
          body: { type: "structureExportResult", requestId: body.requestId, status },
        });
      };
      void (async () => {
        try {
          if (!isTauriRuntime()) {
            downloadTextFile(name, text);
            pushStatus(`Exported ${name}`);
            reply("saved");
            return;
          }
          const outputPath = await save({
            defaultPath: name,
            filters: exportDialogFilters(name, bodyString(body.mimeType, "")),
          });
          if (!outputPath) { reply("cancelled"); return; }
          const savedPath = await invoke<string>("save_text_as", {
            text,
            outputPath,
            sourcePath: null,
          });
          pushStatus(`Exported ${basename(savedPath)}`);
          reply("saved");
        } catch (error) {
          reply("error");
          pushErrorStatus(error, "Molstar export failed");
        }
      })();
      return true;
    }

    if (body?.type === "exportData") {
      const base64 = typeof body.base64 === "string" ? body.base64 : "";
      const name = safeExportFileName(bodyString(body.name, "molstar-export.bin"));
      const mimeType = bodyString(body.mimeType, "application/octet-stream");
      void (async () => {
        try {
          if (!isTauriRuntime()) {
            downloadBase64File(name, base64, mimeType);
            pushStatus(`Exported ${name}`);
            return;
          }
          const outputPath = await save({
            defaultPath: name,
            filters: exportDialogFilters(name, mimeType),
          });
          if (!outputPath) return;
          const savedPath = await invoke<string>("write_base64_file", {
            request: { outputPath, contentsBase64: base64 },
          });
          pushStatus(`Exported ${basename(savedPath)}`);
        } catch (error) {
          pushErrorStatus(error, "Molstar export failed");
        }
      })();
      return true;
    }

    return false;
  }, [postMessageToViewerSource, pushErrorStatus, pushStatus]);

  return { handleViewerFileMessage };
}
