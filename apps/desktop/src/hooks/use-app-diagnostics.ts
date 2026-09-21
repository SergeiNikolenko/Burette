import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import { collectPerformanceMarks, measureAsync } from "../lib/performance";
import { basename } from "../lib/sidebar-projects";
import { isTauriRuntime } from "../lib/tauri";
import type { RecentStatusError } from "./use-app-status";

type UseAppDiagnosticsArgs = {
  recentErrorsRef: { current: RecentStatusError[] };
  pushErrorStatus: (error: unknown, prefix?: string, details?: string[]) => void;
  pushStatus: (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
};

export function useAppDiagnostics({
  recentErrorsRef,
  pushErrorStatus,
  pushStatus,
}: UseAppDiagnosticsArgs) {
  const exportDiagnostics = useCallback(async () => {
    try {
      if (!isTauriRuntime()) {
        pushStatus("Diagnostics export is available in the desktop app only.", "error");
        return;
      }
      const outputPath = await save({
        title: "Export Diagnostics Bundle",
        defaultPath: `Burette-Diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.diagnostics`,
        filters: [{ name: "Burette diagnostics", extensions: ["diagnostics"] }],
      });
      if (!outputPath) return;
      const exportedPath = await measureAsync("ipc:export-diagnostics", () => invoke<string>("export_diagnostics_bundle", {
        outputPath,
        performanceMarks: collectPerformanceMarks(),
        recentErrors: recentErrorsRef.current,
      }));
      pushStatus(`Exported diagnostics to ${basename(exportedPath)}`);
    } catch (error) {
      pushErrorStatus(error, "Diagnostics export failed");
    }
  }, [pushErrorStatus, pushStatus, recentErrorsRef]);

  return { exportDiagnostics };
}
