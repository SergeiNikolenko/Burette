import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showNativeContextMenu } from "../components/native-context-menu";
import { xyzrenderContextMenuItems } from "../components/xyzrender-context-menu";
import { isTauriRuntime } from "../lib/tauri";
import type { PostMessageToViewerSource } from "../lib/viewer-bridge";

type XyzrenderSheetMessageBody = Record<string, unknown> | null | undefined;

type UseAppXyzrenderSheetMessagesOptions = {
  postMessageToViewerSource: PostMessageToViewerSource;
};

export function useAppXyzrenderSheetMessages({
  postMessageToViewerSource,
}: UseAppXyzrenderSheetMessagesOptions) {
  const handleXyzrenderSheetMessage = useCallback((
    sourceName: unknown,
    body: XyzrenderSheetMessageBody,
    source: MessageEventSource | null,
  ) => {
    if (
      sourceName !== "burette-viewer" &&
      sourceName !== "burette-grid"
    ) {
      return false;
    }
    if (body?.type === "xyzrenderContextMenu") {
      if (sourceName !== "burette-viewer" || typeof body.requestId !== "string") return true;
      const reply = (result: { action?: string; unsupported?: boolean }) => postMessageToViewerSource(source, {
        source: "burette-host", body: { type: "xyzrenderContextMenuResult", requestId: body.requestId, ...result },
      });
      const items = xyzrenderContextMenuItems({
        label: typeof body.label === "string" ? body.label : "Structure",
        hasSelection: body.hasSelection === true,
        hasHidden: body.hasHidden === true,
      }, action => reply({ action }));
      const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe.viewer-iframe"))
        .find(candidate => candidate.contentWindow === source);
      const frameRect = frame?.getBoundingClientRect();
      const clientX = Number(body.clientX);
      const clientY = Number(body.clientY);
      const at = frameRect && Number.isFinite(clientX) && Number.isFinite(clientY)
        ? { x: frameRect.left + clientX, y: frameRect.top + clientY }
        : undefined;
      void showNativeContextMenu(items, at).catch(() => reply({ unsupported: true }));
      return true;
    }
    if (body?.type !== "renderXyzrenderSheetItem") return false;
    if (!body.requestId) return true;

    const replySource = sourceName === "burette-grid" ? "burette-grid-host" : "burette-host";
    const reply = (bodyPayload: Record<string, unknown>) => {
      postMessageToViewerSource(source, {
        source: replySource,
        body: {
          requestId: body.requestId,
          documentId: body.documentId,
          ...bodyPayload,
        },
      });
    };

    if (!isTauriRuntime()) {
      reply({
        type: "xyzrenderSheetItemError",
        error: "Desktop xyzrender sheet rendering is unavailable outside the Tauri runtime.",
      });
      return true;
    }

    void (async () => {
      try {
        const result = await invoke<{
          svg: string;
          preset?: string;
          elapsedMs?: number;
          log?: string;
        }>("render_xyzrender_sheet_item", {
          request: {
            path: body.path,
            preset: body.preset ?? null,
            controls: body.controls ?? null,
            inputDataBase64: body.inputDataBase64 ?? null,
            inputExtension: body.inputExtension ?? null,
            orientationRef: body.orientationRef ?? null,
          },
        });
        reply({
          type: "xyzrenderSheetItemRendered",
          svg: result.svg,
          preset: result.preset ?? null,
          elapsedMs: result.elapsedMs ?? null,
          log: result.log ?? "",
        });
      } catch (error) {
        reply({
          type: "xyzrenderSheetItemError",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true;
  }, [postMessageToViewerSource]);

  return { handleXyzrenderSheetMessage };
}
