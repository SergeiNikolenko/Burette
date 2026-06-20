import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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
      sourceName !== "burrete-viewer" &&
      sourceName !== "burrete-grid"
    ) {
      return false;
    }
    if (body?.type !== "renderXyzrenderSheetItem") return false;
    if (!body.requestId) return true;

    const replySource = sourceName === "burrete-grid" ? "burrete-grid-host" : "burrete-host";
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
