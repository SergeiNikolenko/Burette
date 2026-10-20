import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../lib/tauri";
import { defaultPreferences } from "../../stores/settings-store";
import { useShellStore } from "../../stores/shell-store";
import { defaultTabWorkspace, useTabWorkspaceStore } from "../../stores/tab-workspace-store";
import type { ViewerPreferences } from "../../types";
import type { ShellActions } from "../types";
import {
  SelectControl,
  SettingsActionButton,
  SettingsSection,
  TextControl,
  ToggleControl,
  actionRow,
  type SettingRow,
} from "./setting-control";

type SetPreference = ShellActions["setPreference"];

const INTERFACE_SCALES = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const RETENTION_DAYS = [7, 30, 90, 0];
const COMPUTE_BACKENDS: ViewerPreferences["computeBackend"][] = ["auto", "metal", "cpu"];
const COMPUTE_BACKEND_LABELS: Record<ViewerPreferences["computeBackend"], string> = {
  auto: "Automatic",
  metal: "GPU (Metal)",
  cpu: "CPU",
};

function percentLabel(scale: number) {
  return `${Math.round(scale * 100)}%`;
}

function retentionLabel(days: number) {
  return days === 0 ? "Forever" : `${days} days`;
}

function toggleRow<K extends "notifyOnJobCompletion" | "preventSleepDuringJobs" | "restoreSessionOnLaunch">(
  label: string,
  key: K,
  preferences: ViewerPreferences,
  setPreference: SetPreference,
): SettingRow {
  return {
    label,
    control: <ToggleControl label={label} checked={preferences[key]} onChange={(checked) => setPreference(key, checked)} />,
    reset: () => setPreference(key, defaultPreferences[key]),
    isModified: preferences[key] !== defaultPreferences[key],
  };
}

export function restoreSessionRow(preferences: ViewerPreferences, setPreference: SetPreference): SettingRow {
  return toggleRow("Reopen files on launch", "restoreSessionOnLaunch", preferences, setPreference);
}

/** Drives the window zoom; Cmd+= / Cmd+- / Cmd+0 update the same setting. */
export function interfaceScaleRow(preferences: ViewerPreferences, setPreference: SetPreference): SettingRow {
  const value = preferences.interfaceScale;
  const scales = INTERFACE_SCALES.includes(value) ? INTERFACE_SCALES : [...INTERFACE_SCALES, value].sort((a, b) => a - b);
  return {
    label: "Interface scale",
    control: (
      <SelectControl
        label="Interface scale"
        value={String(value)}
        options={scales.map(String)}
        labels={Object.fromEntries(scales.map((scale) => [String(scale), percentLabel(scale)]))}
        onChange={(next) => setPreference("interfaceScale", Number(next))}
      />
    ),
    reset: () => setPreference("interfaceScale", defaultPreferences.interfaceScale),
    isModified: value !== defaultPreferences.interfaceScale,
  };
}

function useMetalAvailable() {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void invoke<{ availability: "available" | "degraded" | "unavailable" }>("compute_capabilities")
      .then((report) => { if (!cancelled) setAvailable(report.availability !== "unavailable"); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);
  return available;
}

function useToolPathDefaults() {
  const [defaults, setDefaults] = useState<{ python: string | null; uv: string | null }>({ python: null, uv: null });
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void invoke<{ python: string | null; uv: string | null }>("tool_path_defaults")
      .then((result) => { if (!cancelled) setDefaults(result); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return defaults;
}

function toolPathRow(
  label: string,
  key: "pythonPath" | "uvPath",
  automaticPath: string | null,
  preferences: ViewerPreferences,
  setPreference: SetPreference,
): SettingRow {
  return {
    label,
    control: (
      <TextControl
        label={label}
        value={preferences[key]}
        placeholder={automaticPath ?? "Automatic"}
        onChange={(value) => setPreference(key, value)}
      />
    ),
    reset: () => setPreference(key, defaultPreferences[key]),
    isModified: preferences[key] !== defaultPreferences[key],
  };
}

export function JobsSettingsSections({ preferences, actions }: { preferences: ViewerPreferences; actions: Pick<ShellActions, "setPreference"> }) {
  const { setPreference } = actions;
  const metalAvailable = useMetalAvailable();
  const toolPaths = useToolPathDefaults();
  return (
    <>
      <SettingsSection
        title="Notifications and power"
        rows={[
          toggleRow("Notify when a job finishes", "notifyOnJobCompletion", preferences, setPreference),
          toggleRow("Keep the Mac awake while jobs run", "preventSleepDuringJobs", preferences, setPreference),
        ]}
      />
      <SettingsSection
        title="Compute"
        rows={[
          {
            label: "Compute backend",
            control: (
              <SelectControl
                label="Compute backend"
                value={preferences.computeBackend}
                options={COMPUTE_BACKENDS}
                labels={COMPUTE_BACKEND_LABELS}
                disabledOptions={metalAvailable === false ? ["metal"] : undefined}
                onChange={(value) => setPreference("computeBackend", value as ViewerPreferences["computeBackend"])}
              />
            ),
            reset: () => setPreference("computeBackend", defaultPreferences.computeBackend),
            isModified: preferences.computeBackend !== defaultPreferences.computeBackend,
          },
          {
            label: "Keep job history",
            control: (
              <SelectControl
                label="Keep job history"
                value={String(preferences.jobHistoryRetentionDays)}
                options={RETENTION_DAYS.map(String)}
                labels={Object.fromEntries(RETENTION_DAYS.map((days) => [String(days), retentionLabel(days)]))}
                onChange={(value) => setPreference("jobHistoryRetentionDays", Number(value))}
              />
            ),
            reset: () => setPreference("jobHistoryRetentionDays", defaultPreferences.jobHistoryRetentionDays),
            isModified: preferences.jobHistoryRetentionDays !== defaultPreferences.jobHistoryRetentionDays,
          },
        ]}
      />
      <SettingsSection
        title="Tool paths"
        rows={[
          toolPathRow("Python", "pythonPath", toolPaths.python, preferences, setPreference),
          toolPathRow("uv", "uvPath", toolPaths.uv, preferences, setPreference),
        ]}
      />
    </>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Puts the sidebar and every tab's docks back at their default sizes. */
function resetPanelLayout() {
  const defaults = defaultTabWorkspace();
  const { workspaces, setDockSize } = useTabWorkspaceStore.getState();
  for (const tabId of Object.keys(workspaces)) {
    setDockSize(tabId, "right", defaults.right.size);
    setDockSize(tabId, "bottom", defaults.bottom.size);
  }
  useShellStore.getState().setSidebarWidth(useShellStore.getInitialState().sidebarWidth);
}

export function useMaintenanceCacheRows(clearCache: ShellActions["clearCache"]): SettingRow[] {
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const refreshCacheSize = useCallback(() => {
    if (!isTauriRuntime()) return;
    void invoke<number>("preview_cache_size").then(setCacheBytes).catch(() => setCacheBytes(null));
  }, []);
  useEffect(refreshCacheSize, [refreshCacheSize]);
  return [
    {
      label: "Preview cache",
      description: cacheBytes === null ? undefined : formatBytes(cacheBytes),
      control: (
        <SettingsActionButton
          label="Clear cache"
          dialogTitle="Clear preview cache?"
          confirm
          disabled={cacheBytes === 0}
          onClick={() => void Promise.resolve(clearCache()).finally(refreshCacheSize)}
        >
          Clear cache
        </SettingsActionButton>
      ),
    },
    actionRow("Panel layout", "", "Reset", resetPanelLayout, false, true),
  ];
}
