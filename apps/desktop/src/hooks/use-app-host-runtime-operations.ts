import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { svgToPngBase64 } from "../lib/preview-image-export";
import { basename } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import type { ViewerDocument } from "../types";
import { useMoleculeStore } from "../stores/molecule-store";
import previewFormats from "../../../../config/preview-formats.json";

const GRID_PERF_REPORT_PATH = String(import.meta.env.BURETTE_GRID_PERF_REPORT_PATH || "");
const gridSourceExtensions = new Set(previewFormats.formats
  .filter(format => format.grid?.enabled)
  .flatMap(format => format.extensions));

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
  const closingGridIdsRef = useRef(new Set<string>());
  const documentsRef = useRef<ViewerDocument[]>([]);
  const documentIndexRef = useRef(new Map<string, ViewerDocument>());

  const closeGridRuntime = useCallback((documentId: string | null | undefined) => {
    if (!documentId || !isTauriRuntime()) return;
    const documents = useMoleculeStore.getState().documents;
    if (documentsRef.current !== documents) {
      documentsRef.current = documents;
      documentIndexRef.current = new Map(documents.map(document => [document.id, document]));
    }
    const document = documentIndexRef.current.get(documentId);
    // Inline compute sources use their own IDs and explicit lease cleanup.
    // Grid-capable sources may retain an older grid runtime after switching
    // renderer. Only skip documents whose format cannot own such a runtime.
    if (document && document.renderer !== "grid2d" && document.viewerProfile !== "grid"
      && !gridSourceExtensions.has(document.extension.toLowerCase())) return;
    const pending = closingGridIdsRef.current;
    const scheduled = pending.size > 0;
    pending.add(documentId);
    if (scheduled) return;
    queueMicrotask(() => {
      const documentIds = [...pending];
      pending.clear();
      void invoke("grid_close_runtime", { documentIds }).catch(() => {});
    });
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
