import { resolveAppearanceTheme } from "../../lib/theme";
import { CODEX_DEFAULT_THEME } from "../../lib/codex-theme";
import type { ViewerPreferences } from "../../types";
import { defaultPreferences } from "../../stores/settings-store";
import type { ShellActions } from "../types";
import {
  SettingsSection,
  colorPreferenceRow,
  rangePreferenceRow,
  textPreferenceRow,
  type SettingRow,
} from "./setting-control";

type ThemeMode = "light" | "dark";
type ThemePrefix = "themeLight" | "themeDark";
type ThemeColorKey =
  | "themeLightAccent"
  | "themeLightBackground"
  | "themeLightForeground"
  | "themeDarkAccent"
  | "themeDarkBackground"
  | "themeDarkForeground";
type ThemeTextKey =
  | "themeLightUiFont"
  | "themeLightEditorFont"
  | "themeDarkUiFont"
  | "themeDarkEditorFont";
type ThemeRangeKey =
  | "themeLightTranslucent"
  | "themeLightContrast"
  | "themeDarkTranslucent"
  | "themeDarkContrast";

export function ThemesSection({
  preferences,
  actions,
}: {
  preferences: ViewerPreferences;
  actions: ShellActions;
}) {
  return (
    <>
      <ThemeCard mode="light" preferences={preferences} actions={actions} />
      <ThemeCard mode="dark" preferences={preferences} actions={actions} />
    </>
  );
}

function ThemeCard({
  mode,
  preferences,
  actions,
}: {
  mode: ThemeMode;
  preferences: ViewerPreferences;
  actions: ShellActions;
}) {
  const title = mode === "light" ? "Light Theme" : "Dark Theme";
  const prefix: ThemePrefix = mode === "light" ? "themeLight" : "themeDark";
  const rows: SettingRow[] = [
    themeColorRow(prefix, "Accent", "Accent", preferences, actions),
    themeColorRow(prefix, "Background", "Background", preferences, actions),
    themeColorRow(prefix, "Foreground", "Foreground", preferences, actions),
    themeTextRow(prefix, "UI font", "UiFont", preferences, actions),
    themeTextRow(prefix, "Editor font", "EditorFont", preferences, actions),
    themeRangeRow(prefix, "Translucency", "Translucent", preferences, actions),
    themeRangeRow(prefix, "Contrast", "Contrast", preferences, actions),
  ];
  return <SettingsSection title={title} rows={rows} />;
}

function themeColorRow(
  prefix: ThemePrefix,
  label: string,
  suffix: "Accent" | "Background" | "Foreground",
  preferences: ViewerPreferences,
  actions: ShellActions,
) {
  const key = `${prefix}${suffix}` as ThemeColorKey;
  const mode = prefix === "themeLight" ? "light" : "dark";
  const theme = resolveAppearanceTheme(preferences, mode);
  const field = { Accent: "accent", Background: "surface", Foreground: "ink" } as const;
  return colorPreferenceRow(
    label,
    "",
    theme[field[suffix]],
    CODEX_DEFAULT_THEME[mode][field[suffix]],
    (value) => actions.setPreference(key, value),
  );
}

function themeTextRow(
  prefix: ThemePrefix,
  label: string,
  suffix: "UiFont" | "EditorFont",
  preferences: ViewerPreferences,
  actions: ShellActions,
) {
  const key = `${prefix}${suffix}` as ThemeTextKey;
  return textPreferenceRow(
    label,
    "",
    String(preferences[key]),
    String(defaultPreferences[key]),
    (value) => actions.setPreference(key, value),
  );
}

function themeRangeRow(
  prefix: ThemePrefix,
  label: string,
  suffix: "Translucent" | "Contrast",
  preferences: ViewerPreferences,
  actions: ShellActions,
) {
  const key = `${prefix}${suffix}` as ThemeRangeKey;
  const mode = prefix === "themeLight" ? "light" : "dark";
  return rangePreferenceRow(
    label,
    "",
    suffix === "Contrast" ? resolveAppearanceTheme(preferences, mode).contrast : preferences[key],
    suffix === "Contrast" ? CODEX_DEFAULT_THEME[mode].contrast : defaultPreferences[key],
    (value) => actions.setPreference(key, value),
  );
}
