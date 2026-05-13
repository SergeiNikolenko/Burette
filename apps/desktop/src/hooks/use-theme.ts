import { useCallback } from "react";
import {
  getSetting,
  setSetting,
} from "../stores/settings-store";
import type { ViewerPreferences } from "../types";
import { useSetting } from "./use-settings";

type ThemePreference = ViewerPreferences["theme"];

function nextThemePreference(current: ThemePreference): ThemePreference {
  return current === "dark" ? "light" : "dark";
}

export function toggleTheme() {
  setSetting("theme", nextThemePreference(getSetting("theme")));
}

export function useTheme() {
  const themePreference = useSetting("theme");
  const doToggleTheme = useCallback(() => toggleTheme(), []);

  return { themePreference, toggleTheme: doToggleTheme };
}
