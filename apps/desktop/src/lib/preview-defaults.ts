import { readPreviewThemeTokens } from "./theme-tokens";
import type { ViewerPreferences } from "../types";

type PreviewThemeTokenSet = {
  accent: string;
  background: string;
  foreground: string;
  uiFont: string;
  editorFont: string;
  translucent: number;
  contrast: number;
};

// The viewer runtime carries both token sets so a theme switch never rebuilds it.
// The embeddable viewer build reads the same values, so it matches the desktop app.
export function previewThemeTokens(preferences: ViewerPreferences): Record<"light" | "dark", PreviewThemeTokenSet> {
  return {
    light: readPreviewThemeTokens(preferences, "light"),
    dark: readPreviewThemeTokens(preferences, "dark"),
  };
}

// App Settings defaults the runtimes start from; the same shape as
// ViewerDefaults::runtime_config in src-tauri/src/preview/runtime.rs.
export function previewViewerDefaults(preferences: ViewerPreferences) {
  return {
    screenshotResolution: preferences.screenshotResolution,
    screenshotFormat: preferences.screenshotFormat,
    screenshotTransparent: preferences.screenshotTransparent,
    gridViewMode: preferences.gridViewMode,
    gridCardRenderer: preferences.gridCardRenderer,
    gridCardSize: preferences.gridCardSize,
    hydrogenDisplay: preferences.hydrogenDisplay,
  };
}
