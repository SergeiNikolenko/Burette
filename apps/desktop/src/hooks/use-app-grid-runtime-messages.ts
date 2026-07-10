import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import { readStructureText } from "../lib/structure-text";
import { isTauriRuntime } from "../lib/tauri";
import type { PostMessageToViewerSource } from "../lib/viewer-bridge";

type GridRuntimeMessageBody = Record<string, unknown> | null | undefined;

type UseAppGridRuntimeMessagesOptions = {
  postMessageToViewerSource: PostMessageToViewerSource;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function useAppGridRuntimeMessages({
  postMessageToViewerSource,
}: UseAppGridRuntimeMessagesOptions) {
  const replyGrid = useCallback((
    source: MessageEventSource | null,
    requestId: unknown,
    documentId: unknown,
    bodyPayload: Record<string, unknown>,
  ) => {
    postMessageToViewerSource(source, {
      source: "burrete-grid-host",
      body: {
        requestId,
        documentId,
        ...bodyPayload,
      },
    });
  }, [postMessageToViewerSource]);

  const handleGridRuntimeMessage = useCallback((body: GridRuntimeMessageBody, source: MessageEventSource | null) => {
    if (body?.type === "gridFetchPage") {
      if (!body.requestId || !body.documentId) return true;
      if (!isTauriRuntime()) {
        replyGrid(source, body.requestId, body.documentId, {
          type: "gridError",
          error: "Desktop grid paging is unavailable outside the Tauri runtime.",
        });
        return true;
      }
      void (async () => {
        try {
          const result = await invoke("grid_fetch_page", {
            request: {
              documentId: body.documentId,
              query: typeof body.query === "string" ? body.query : "",
              sort: typeof body.sort === "string" ? body.sort : "index",
              descriptorFilters: Array.isArray(body.descriptorFilters) ? body.descriptorFilters : [],
              descriptorSort: body.descriptorSort && typeof body.descriptorSort === "object" ? body.descriptorSort : null,
              offset: typeof body.offset === "number" ? body.offset : 0,
              limit: typeof body.limit === "number" ? body.limit : 96,
            },
          });
          replyGrid(source, body.requestId, body.documentId, {
            type: "gridPage",
            result,
          });
        } catch (error) {
          replyGrid(source, body.requestId, body.documentId, {
            type: "gridError",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return true;
    }

    if (body?.type === "readStructureText") {
      if (!body.requestId || !body.documentId) return true;
      void (async () => {
        try {
          const path = typeof body.path === "string" ? body.path : "";
          const text = isTauriRuntime()
            ? await invoke<string>("read_structure_text", { path })
            : readBrowserDevVirtualTextDocument(path) ?? await readStructureText(path);
          replyGrid(source, body.requestId, body.documentId, {
            type: "structureText",
            text,
          });
        } catch (error) {
          replyGrid(source, body.requestId, body.documentId, {
            type: "gridError",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return true;
    }

    if (body?.type === "renderXyzrenderCard") {
      if (!body.requestId || !body.documentId) return true;
      if (!isTauriRuntime()) {
        replyGrid(source, body.requestId, body.documentId, {
          type: "gridError",
          error: "Desktop xyzrender grid rendering is unavailable outside the Tauri runtime.",
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
            cacheHit?: boolean;
          }>("render_xyzrender_sheet_item", {
            request: {
              path: body.path,
              preset: body.preset ?? null,
              controls: body.controls ?? null,
              inputDataBase64: body.inputDataBase64 ?? null,
              inputExtension: body.inputExtension ?? null,
              cacheScope: "grid-card",
            },
          });
          replyGrid(source, body.requestId, body.documentId, {
            type: "xyzrenderCard",
            result: {
              svg: result.svg,
              preset: result.preset ?? null,
              elapsedMs: result.elapsedMs ?? null,
              log: result.log ?? "",
              cacheHit: result.cacheHit ?? false,
            },
          });
        } catch (error) {
          replyGrid(source, body.requestId, body.documentId, {
            type: "gridError",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return true;
    }

    if (body?.type === "renderXyzrenderCards") {
      if (!body.requestId || !body.documentId) return true;
      if (!isTauriRuntime()) {
        replyGrid(source, body.requestId, body.documentId, {
          type: "gridError",
          error: "Desktop xyzrender grid rendering is unavailable outside the Tauri runtime.",
        });
        return true;
      }
      void (async () => {
        try {
          const items = Array.isArray(body.items) ? body.items : [];
          const result = await invoke<{
            items?: Array<{
              id?: string;
              svg?: string;
              preset?: string;
              elapsedMs?: number;
              log?: string;
              cacheHit?: boolean;
              error?: string;
            }>;
          }>("render_xyzrender_sheet_items", {
            request: {
              items: items.map((item) => {
                const record = asRecord(item);
                return {
                  id: typeof record.id === "string" ? record.id : "",
                  path: typeof record.path === "string" ? record.path : "",
                  preset: record.preset ?? null,
                  controls: record.controls ?? null,
                  inputDataBase64: record.inputDataBase64 ?? null,
                  inputExtension: record.inputExtension ?? null,
                  cacheScope: "grid-card",
                };
              }),
            },
          });
          replyGrid(source, body.requestId, body.documentId, {
            type: "xyzrenderCard",
            result: {
              items: result.items ?? [],
            },
          });
        } catch (error) {
          replyGrid(source, body.requestId, body.documentId, {
            type: "gridError",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      return true;
    }

    return false;
  }, [replyGrid]);

  return { handleGridRuntimeMessage };
}
