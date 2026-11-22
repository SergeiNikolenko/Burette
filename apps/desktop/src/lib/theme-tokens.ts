import type { ViewerPreferences } from "../types";
import { codexThemeFromTokens, type CodexTheme } from "./codex-theme";

export type ThemeMode = "light" | "dark";

export type HostThemeSource = {
  theme?: ThemeMode;
  backgrounds?: { light: string; dark: string };
};

export function hostThemeSource(): HostThemeSource | null {
  if (typeof window === "undefined") return null;
  if (window.BuretteMcpWorkspace) return window.BuretteMcpWorkspace;
  if (window.__BURETTE_HOSTED_MCP_WIDGET__ === true) {
    const bridge = window.BuretteHostedAppBridge;
    if (bridge?.theme || bridge?.backgrounds) return bridge;
    const openAiTheme = window.openai?.theme;
    if (openAiTheme === "light" || openAiTheme === "dark") return { theme: openAiTheme };
  }
  return null;
}

type ThemeTokens = {
  accent: string;
  background: string;
  foreground: string;
  uiFont: string;
  editorFont: string;
  translucent: number;
  contrast: number;
};

export function readThemeTokens(preferences: ViewerPreferences, mode: ThemeMode): ThemeTokens {
  if (mode === "light") {
    return {
      accent: preferences.themeLightAccent,
      background: preferences.themeLightBackground,
      foreground: preferences.themeLightForeground,
      uiFont: preferences.themeLightUiFont,
      editorFont: preferences.themeLightEditorFont,
      translucent: preferences.themeLightTranslucent,
      contrast: preferences.themeLightContrast,
    };
  }
  return {
    accent: preferences.themeDarkAccent,
    background: preferences.themeDarkBackground,
    foreground: preferences.themeDarkForeground,
    uiFont: preferences.themeDarkUiFont,
    editorFont: preferences.themeDarkEditorFont,
    translucent: preferences.themeDarkTranslucent,
    contrast: preferences.themeDarkContrast,
  };
}

export function resolveAppearanceTheme(preferences: ViewerPreferences, mode: ThemeMode): CodexTheme {
  const theme = codexThemeFromTokens(readThemeTokens(preferences, mode), mode);
  const host = hostThemeSource();
  if (!host) return theme;
  const fallbackSurface = typeof window !== "undefined" && window.BuretteMcpWorkspace
    ? (mode === "dark" ? "#101010" : "#ffffff")
    : (mode === "dark" ? "#181818" : "#ffffff");
  return { ...theme, surface: host.backgrounds?.[mode] ?? fallbackSurface };
}

// The viewer frames derive their chrome from these colours, so they get the
// same Codex defaults the shell resolves for untouched appearance values.
export function readPreviewThemeTokens(preferences: ViewerPreferences, mode: ThemeMode): ThemeTokens {
  const tokens = readThemeTokens(preferences, mode);
  const codex = resolveAppearanceTheme(preferences, mode);
  return { ...tokens, accent: codex.accent, background: codex.surface, foreground: codex.ink, contrast: codex.contrast };
}
