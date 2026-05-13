import { defaultPreferences, useAppStore } from "../store";
import type { SettingsMap, SettingKey } from "../lib/settings-schema";
import { isTauriRuntime } from "../lib/runtime";
import * as tauri from "../lib/tauri";

export type { SettingsMap, SettingKey };

export const useSettingsStore = useAppStore;

export function getSetting<K extends SettingKey>(key: K): SettingsMap[K] {
  return useAppStore.getState().preferences[key];
}

export function setSetting<K extends SettingKey>(key: K, value: SettingsMap[K]) {
  useAppStore.getState().setPreference(key, value);
  if (isTauriRuntime()) {
    void tauri.setSetting(key, value).catch((error) => {
      console.error("Failed to save setting", key, error);
    });
  }
}

export async function hydrateSettingsFromBackend() {
  if (!isTauriRuntime()) return;
  const settings = await tauri.getSettings();
  if (JSON.stringify(settings) === JSON.stringify(defaultPreferences)) return;
  useAppStore.getState().setPreferences(settings);
}

export async function resetSetting<K extends SettingKey>(key: K) {
  if (isTauriRuntime()) {
    await tauri.resetSetting(key);
    useAppStore.getState().setPreferences(await tauri.getSettings());
    return;
  }
  useAppStore.getState().setPreference(key, useAppStore.getInitialState().preferences[key]);
}
