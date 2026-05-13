import type { CSSProperties } from "react";
import type { ViewerPreferences } from "../types";

export type ThemePreference = ViewerPreferences["theme"];
export type ThemeMode = "light" | "dark";

export function activeMode(preference: ThemePreference): ThemeMode {
  if (preference === "dark" || preference === "light") return preference;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function themeStyle(preferences: ViewerPreferences): CSSProperties {
  const mode = activeMode(preferences.theme);
  const theme = preferences.themeOverrides[mode];
  return {
    "--accent": theme.accent,
    "--bg-base": theme.background,
    "--fg-base": theme.foreground,
    "--bg-opacity": String(theme.backgroundOpacity),
    "--contrast": String(theme.contrast),
  } as CSSProperties;
}

export function applyTheme(preferences: ViewerPreferences) {
  if (typeof document === "undefined") return;
  const mode = activeMode(preferences.theme);
  document.documentElement.setAttribute("data-theme", mode);
  const style = themeStyle(preferences);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(style)) {
    root.style.setProperty(key, String(value));
  }
}
