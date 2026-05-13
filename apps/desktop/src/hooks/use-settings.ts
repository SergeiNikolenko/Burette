import {
  setSetting,
  useSettingsStore,
} from "../stores/settings-store";
import type { SettingKey, SettingsMap } from "../lib/settings-schema";

export type { SettingKey, SettingsMap };

export function useSetting<K extends SettingKey>(key: K): SettingsMap[K] {
  return useSettingsStore((state) => state.preferences[key]);
}

export function useSetSetting() {
  return setSetting;
}

export function useAllSettings(): SettingsMap {
  return useSettingsStore((state) => state.preferences);
}
