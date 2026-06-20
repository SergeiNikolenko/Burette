import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "../lib/tauri";

type UseAppMaintenanceArgs = {
  pushErrorStatus: (error: unknown, prefix?: string, details?: string[]) => void;
  pushStatus: (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;
};

type ExternalRuntimeDoctorCheck = {
  id: string;
  label: string;
  kind: string;
  available: boolean;
  source?: string | null;
  executablePath?: string | null;
  version?: string | null;
  message: string;
  installHint?: string | null;
};

type ExternalRuntimeDoctorReport = {
  schema: string;
  checks: ExternalRuntimeDoctorCheck[];
};

function doctorDetail(check: ExternalRuntimeDoctorCheck) {
  const source = check.source ? ` (${check.source})` : "";
  const version = check.version ? ` ${check.version}` : "";
  return `${check.label}: ${check.available ? "available" : "unavailable"}${version}${source}`;
}

export function useAppMaintenance({ pushErrorStatus, pushStatus }: UseAppMaintenanceArgs) {
  const clearCache = useCallback(async () => {
    try {
      await invoke("clear_preview_cache");
      pushStatus("Preview cache cleared");
    } catch (error) {
      pushErrorStatus(error, "Preview cache clear failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const resetQuickLook = useCallback(async () => {
    try {
      const report = await invoke<{ ok: boolean }>("reset_quick_look");
      pushStatus(report.ok ? "Quick Look reset completed" : "Quick Look reset reported issues", report.ok ? "info" : "error");
    } catch (error) {
      pushErrorStatus(error, "Quick Look reset failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const openLogs = useCallback(async () => {
    try {
      await invoke("open_logs_folder");
      pushStatus("Opened logs folder");
    } catch (error) {
      pushErrorStatus(error, "Open logs folder failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const runExternalRuntimeDoctor = useCallback(async () => {
    if (!isTauriRuntime()) {
      pushStatus("Runtime doctor is available in the desktop app only.", "error");
      return;
    }
    try {
      const report = await invoke<ExternalRuntimeDoctorReport>("external_runtime_doctor");
      const available = report.checks.filter((check) => check.available).length;
      const total = report.checks.length;
      const missing = report.checks.filter((check) => !check.available);
      pushStatus(
        `Runtime doctor: ${available}/${total} checks available`,
        missing.length ? "error" : "success",
        report.checks.map(doctorDetail),
      );
    } catch (error) {
      pushErrorStatus(error, "Runtime doctor failed");
    }
  }, [pushErrorStatus, pushStatus]);

  const openNewWindow = useCallback(async () => {
    if (!isTauriRuntime()) {
      pushStatus("New windows are available in the desktop app only.", "error");
      return;
    }
    try {
      await invoke<string>("open_new_workspace_window");
      pushStatus("Opened new window");
    } catch (error) {
      pushErrorStatus(error, "Open new window failed");
    }
  }, [pushErrorStatus, pushStatus]);

  return {
    clearCache,
    openLogs,
    openNewWindow,
    resetQuickLook,
    runExternalRuntimeDoctor,
  };
}
