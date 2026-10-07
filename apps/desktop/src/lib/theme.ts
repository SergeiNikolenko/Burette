import { useSyncExternalStore, type CSSProperties } from "react";
import type { ViewerPreferences } from "../types";
import { buildCodexThemeVariables, CODEX_DEFAULT_THEME, type CodexTheme } from "./codex-theme";

export type ThemeMode = "light" | "dark";

type ThemeTokens = {
  accent: string;
  background: string;
  foreground: string;
  uiFont: string;
  editorFont: string;
  translucent: number;
  contrast: number;
};

export function readSystemThemeMode(): ThemeMode {
  if (typeof window !== "undefined" && window.BuretteMcpWorkspace) return window.BuretteMcpWorkspace.theme;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function subscribeSystemThemeMode(onChange: () => void): () => void {
  if (typeof window !== "undefined" && window.BuretteMcpWorkspace) {
    window.addEventListener("burette-host-theme", onChange);
    return () => window.removeEventListener("burette-host-theme", onChange);
  }
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: light)");
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }
  media.addListener(onChange);
  return () => media.removeListener(onChange);
}

export function useSystemThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeSystemThemeMode, readSystemThemeMode, () => "dark");
}

export function resolveThemeMode(theme: ViewerPreferences["theme"], systemThemeMode = readSystemThemeMode()): ThemeMode {
  if (typeof window !== "undefined" && window.BuretteMcpWorkspace) return systemThemeMode;
  if (theme === "light" || theme === "dark") return theme;
  return systemThemeMode;
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

// Appearance values saved before the Codex theme. A field still holding one of
// these was never customized, so it follows the Codex default instead.
const LEGACY_DEFAULTS: Record<ThemeMode, CodexTheme> = {
  light: { accent: "#af52de", surface: "#ffffff", ink: "#0d0d0d", contrast: 20 },
  dark: { accent: "#af52de", surface: "#111111", ink: "#fcfcfc", contrast: 16 },
};

function codexThemeFromTokens(tokens: ThemeTokens, mode: ThemeMode): CodexTheme {
  const legacy = LEGACY_DEFAULTS[mode];
  const fallback = CODEX_DEFAULT_THEME[mode];
  const color = (value: string, key: "accent" | "surface" | "ink") => {
    const normalized = value.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized) && normalized !== legacy[key] ? normalized : fallback[key];
  };
  return {
    accent: color(tokens.accent, "accent"),
    surface: color(tokens.background, "surface"),
    ink: color(tokens.foreground, "ink"),
    contrast: tokens.contrast === legacy.contrast ? fallback.contrast : clamp(tokens.contrast, 0, 100),
  };
}

export function buildThemeStyle(preferences: ViewerPreferences, systemThemeMode?: ThemeMode): CSSProperties {
  const mode = resolveThemeMode(preferences.theme, systemThemeMode);
  const tokens = readThemeTokens(preferences, mode);
  const codex = codexThemeFromTokens(tokens, mode);
  const bgOpacity = 1 - (clamp(tokens.translucent, 0, 100) / 100) * 0.95;
  const shellBgOpacity = mode === "light" ? Math.min(bgOpacity, 0.715) : bgOpacity;
  // Burette's semantic names resolve to Codex tokens (styles/codex-tokens.css).
  const style = {
    ...buildCodexThemeVariables(codex, mode),
    "--accent": codex.accent,
    "--bg-base": codex.surface,
    "--fg-base": codex.ink,
    "--ui-font": tokens.uiFont,
    "--editor-font": tokens.editorFont,
    "--bg-opacity": String(shellBgOpacity),
    "--contrast": String(0.2 + (codex.contrast / 100) * 0.8),
    "--bg": "color-mix(in srgb, var(--color-token-side-bar-background) calc(var(--bg-opacity) * 100%), transparent)",
    "--text": "var(--text-primary)",
    "--text-primary": "var(--color-text-primary)",
    "--control-radius": "var(--radius-lg)",
    "--text-secondary": "var(--color-text-secondary)",
    "--text-muted": "var(--color-text-tertiary)",
    "--text-faint": "var(--color-text-tertiary)",
    "--text-icon-muted": "var(--app-color-icon-tertiary)",
    "--border-color": "var(--color-border)",
    "--line": "var(--color-border)",
    "--line-subtle": "var(--color-border)",
    "--line-subtler": "var(--color-border-subtle)",
    "--focus-border": "var(--color-ring)",
    "--line-strong": "var(--color-border-strong)",
    "--sidebar-divider-right": "transparent",
    "--workspace-edge-border": "var(--color-border)",
    "--workspace-edge-shadow": "rgb(0 0 0 / 0.055)",
    "--surface-primary": "var(--color-token-main-surface-primary)",
    "--surface-card": mode === "light" ? "transparent" : "var(--app-color-background-elevated-secondary)",
    "--surface-subtle": "var(--color-background-secondary-soft)",
    "--surface-subtle-strong": "var(--color-background-primary-ghost-active)",
    "--surface-hover": "var(--color-token-list-hover-background)",
    "--surface-active": "var(--color-background-primary-ghost-active)",
    "--surface-input": "var(--color-background-secondary-soft)",
    "--surface-selected": "var(--color-token-list-hover-background)",
    "--surface-palette": "var(--app-color-background-elevated-primary)",
    "--item-hover-bg": "var(--color-token-list-hover-background)",
    "--item-active-bg": "var(--color-background-primary-ghost-active)",
    "--kbd-bg": "var(--color-background-secondary-soft)",
    "--scrollbar-thumb": "var(--color-token-scrollbar-slider-hover-background)",
    "--tab-active-bg": "var(--color-background-control-opaque)",
  } as CSSProperties;
  return style;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
