import type { CSSProperties } from "react";
import type { ViewerPreferences } from "../types";

type ThemeMode = "light" | "dark";

type ThemeTokens = {
  accent: string;
  background: string;
  foreground: string;
  uiFont: string;
  editorFont: string;
  translucent: number;
  contrast: number;
};

export function resolveThemeMode(theme: ViewerPreferences["theme"]): ThemeMode {
  if (theme === "light" || theme === "dark") return theme;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

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

export function buildThemeStyle(preferences: ViewerPreferences): CSSProperties {
  const mode = resolveThemeMode(preferences.theme);
  const tokens = readThemeTokens(preferences, mode);
  const bgOpacity = 1 - (clamp(tokens.translucent, 0, 100) / 100) * 0.95;
  const contrast = 0.2 + (clamp(tokens.contrast, 0, 100) / 100) * 0.8;
  const fgMix = "color-mix(in srgb, var(--fg-base)";
  const style = {
    "--accent": tokens.accent,
    "--bg-base": tokens.background,
    "--fg-base": tokens.foreground,
    "--ui-font": tokens.uiFont,
    "--editor-font": tokens.editorFont,
    "--bg-opacity": String(bgOpacity),
    "--contrast": String(contrast),
    "--bg": `color-mix(in srgb, var(--bg-base) calc(var(--bg-opacity) * 100%), transparent)`,
    "--text": "var(--fg-base)",
    "--text-primary": "var(--fg-base)",
    "--text-secondary": `${fgMix} 80%, transparent)`,
    "--text-muted": `${fgMix} 54%, transparent)`,
    "--text-faint": `${fgMix} 40%, transparent)`,
    "--text-icon-muted": `${fgMix} 40%, transparent)`,
    "--border-color": `${fgMix} calc(var(--contrast) * 24%), transparent)`,
    "--line": `${fgMix} calc(var(--contrast) * 24%), transparent)`,
    "--line-subtle": `${fgMix} calc(var(--contrast) * 24%), transparent)`,
    "--line-subtler": `${fgMix} calc(var(--contrast) * 15%), transparent)`,
    "--focus-border": `${fgMix} calc(var(--contrast) * 65%), transparent)`,
    "--line-strong": `${fgMix} calc(var(--contrast) * 65%), transparent)`,
    "--surface-primary": "var(--bg-base)",
    "--surface-card": mode === "light" ? "transparent" : `${fgMix} calc(var(--contrast) * 16%), transparent)`,
    "--surface-subtle": `${fgMix} calc(var(--contrast) * 18%), transparent)`,
    "--surface-subtle-strong": `${fgMix} calc(var(--contrast) * 36%), transparent)`,
    "--surface-hover": `${fgMix} calc(var(--contrast) * 26%), transparent)`,
    "--surface-active": `${fgMix} calc(var(--contrast) * 26%), transparent)`,
    "--surface-input": `${fgMix} calc(var(--contrast) * ${mode === "light" ? "20" : "28"}%), transparent)`,
    "--surface-selected": `${fgMix} calc(var(--contrast) * 26%), transparent)`,
    "--surface-palette": "color-mix(in srgb, var(--bg-base) 80%, transparent)",
    "--item-hover-bg": `${fgMix} calc(var(--contrast) * 16%), transparent)`,
    "--item-active-bg": `${fgMix} calc(var(--contrast) * 26%), transparent)`,
    "--kbd-bg": `${fgMix} calc(var(--contrast) * 16%), transparent)`,
    "--scrollbar-thumb": `${fgMix} calc(var(--contrast) * 58%), transparent)`,
    "--tab-active-bg": `${fgMix} calc(var(--contrast) * ${mode === "dark" ? "34" : "24"}%), transparent)`,
  } as CSSProperties;
  return style;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
