import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { svgToPngBase64 } from "../lib/preview-image-export";
import { basename } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import type { ViewerDocument } from "../types";

const GRID_PERF_REPORT_PATH = "/private/tmp/burrete-grid-real-app-perf.jsonl";

type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

type UseAppHostRuntimeOperationsOptions = {
  activeDocument: ViewerDocument | null | undefined;
  pushErrorStatus: PushErrorStatus;
  pushStatus: PushStatus;
};

export function useAppHostRuntimeOperations({
  activeDocument,
  pushErrorStatus,
  pushStatus,
}: UseAppHostRuntimeOperationsOptions) {
  const gridPerfMetricsRef = useRef<string[]>([]);

  const closeGridRuntime = useCallback((documentId: string | null | undefined) => {
    if (!documentId || !isTauriRuntime()) return;
    void invoke("grid_close_runtime", { documentId }).catch(() => {});
  }, []);

  const readActiveExternalPreviewSvg = useCallback(async () => {
    if (!activeDocument) throw new Error("No active structure preview to export");
    if (!isTauriRuntime()) throw new Error("Preview export is available in the desktop app only");
    return invoke<string>("read_external_preview_svg", { runtimePath: activeDocument.runtimePath });
  }, [activeDocument]);

  const exportActivePreviewAsSvg = useCallback(async () => {
    try {
      const svg = await readActiveExternalPreviewSvg();
      const outputPath = await save({
        defaultPath: `${activeDocument?.title ?? "preview"}.svg`,
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (!outputPath) return;
      const savedPath = await invoke<string>("write_text_file", {
        request: { outputPath, contents: svg },
      });
      pushStatus(`Exported preview to ${basename(savedPath)}`);
    } catch (error) {
      pushErrorStatus(error, "Export SVG failed");
    }
  }, [activeDocument?.title, pushErrorStatus, pushStatus, readActiveExternalPreviewSvg]);

  const exportActivePreviewAsPng = useCallback(async () => {
    try {
      const svg = await readActiveExternalPreviewSvg();
      const pngBase64 = await svgToPngBase64(svg);
      const outputPath = await save({
        defaultPath: `${activeDocument?.title ?? "preview"}.png`,
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (!outputPath) return;
      const savedPath = await invoke<string>("write_base64_file", {
        request: { outputPath, contentsBase64: pngBase64 },
      });
      pushStatus(`Exported preview to ${basename(savedPath)}`);
    } catch (error) {
      pushErrorStatus(error, "Export PNG failed");
    }
  }, [activeDocument?.title, pushErrorStatus, pushStatus, readActiveExternalPreviewSvg]);

  const writeGridPerfMetric = useCallback((body: unknown) => {
    if (!isTauriRuntime()) return;
    const line = JSON.stringify({
      receivedAtMs: Date.now(),
      metric: body,
    });
    gridPerfMetricsRef.current = [...gridPerfMetricsRef.current.slice(-399), line];
    void invoke("write_text_file", {
      request: {
        outputPath: GRID_PERF_REPORT_PATH,
        contents: `${gridPerfMetricsRef.current.join("\n")}\n`,
      },
    }).catch(() => {});
  }, []);

  return {
    closeGridRuntime,
    exportActivePreviewAsPng,
    exportActivePreviewAsSvg,
    writeGridPerfMetric,
  };
}
