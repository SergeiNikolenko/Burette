import { useSettingsStore } from "../stores/settings-store";

export function useViewerPreferences() {
  return useSettingsStore((state) => state.preferences);
}

export function useSetViewerPreference() {
  return useSettingsStore((state) => state.setPreference);
}
