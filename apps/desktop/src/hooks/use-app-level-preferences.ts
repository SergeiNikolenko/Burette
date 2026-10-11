import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../lib/tauri";
import { useSettingsStore } from "../stores/settings-store";
import type { ViewerPreferences } from "../types";

type PushErrorStatus = (error: unknown, prefix?: string, details?: string[]) => void;

/** Emitted by the native zoom commands (Cmd+= / Cmd+- / Cmd+0). */
const INTERFACE_SCALE_EVENT = "interface-scale-changed";

/**
 * Pushes the preferences native code reads on its own (compute backend, tool
 * paths, job history retention, interface scale) and keeps the interface scale
 * setting in step with keyboard zoom.
 */
export function useAppLevelPreferences(preferences: ViewerPreferences, pushErrorStatus: PushErrorStatus) {
  const { computeBackend, pythonPath, uvPath, jobHistoryRetentionDays, interfaceScale } = preferences;

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("sync_app_preferences", {
      preferences: { computeBackend, pythonPath, uvPath, jobHistoryRetentionDays },
    }).catch((error) => pushErrorStatus(error, "App preference sync failed"));
  }, [computeBackend, jobHistoryRetentionDays, pushErrorStatus, pythonPath, uvPath]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("set_interface_scale", { scale: interfaceScale })
      .catch((error) => pushErrorStatus(error, "Interface scale failed"));
  }, [interfaceScale, pushErrorStatus]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen<number>(INTERFACE_SCALE_EVENT, (event) => {
      if (Number.isFinite(event.payload)) useSettingsStore.getState().setPreference("interfaceScale", event.payload);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);
}
