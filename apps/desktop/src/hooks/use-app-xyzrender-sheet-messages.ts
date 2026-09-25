import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { molstarContextMenuItems } from "../components/molstar-context-menu";
import { showNativeContextMenu } from "../components/native-context-menu";
import { xyzrenderContextMenuItems } from "../components/xyzrender-context-menu";
import { isTauriRuntime } from "../lib/tauri";
import type { PostMessageToViewerSource } from "../lib/viewer-bridge";

type XyzrenderSheetMessageBody = Record<string, unknown> | null | undefined;

type UseAppXyzrenderSheetMessagesOptions = {
  postMessageToViewerSource: PostMessageToViewerSource;
};

// A viewer reports its click in frame coordinates; the menu opens in window ones.
function viewerFramePoint(source: MessageEventSource | null, body: Record<string, unknown>) {
  const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe.viewer-iframe"))
    .find(candidate => candidate.contentWindow === source);
  const frameRect = frame?.getBoundingClientRect();
  const clientX = Number(body.clientX);
  const clientY = Number(body.clientY);
  return frameRect && Number.isFinite(clientX) && Number.isFinite(clientY)
    ? { x: frameRect.left + clientX, y: frameRect.top + clientY }
    : undefined;
}

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
      void showNativeContextMenu(items, viewerFramePoint(source, body)).catch(() => reply({ unsupported: true }));
      return true;
    }
    if (body?.type === "molstarContextMenu") {
      const requestId = body.requestId;
      if (sourceName !== "burette-viewer" || typeof requestId !== "string" || requestId.length > 128) return true;
      const reply = (result: { event: "select" | "closed" | "unsupported"; id?: string; value?: string | number | boolean }) =>
        postMessageToViewerSource(source, { source: "burette-host", body: { type: "molstarContextMenuResult", requestId, ...result } });
      // Browser-dev keeps the viewer's own menu; only the desktop app has NSMenu.
      const items = isTauriRuntime() ? molstarContextMenuItems(body.items, (id, value) => reply({ event: "select", id, value })) : [];
      if (!items.length) {
        reply({ event: "unsupported" });
        return true;
      }
      void showNativeContextMenu(items, viewerFramePoint(source, body))
        .then(() => reply({ event: "closed" }), () => reply({ event: "unsupported" }));
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
