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
    themeColorRow(prefix, "Accent", "Primary action and selection color.", "Accent", preferences, actions),
    themeColorRow(prefix, "Background", "Base window and preview background.", "Background", preferences, actions),
    themeColorRow(prefix, "Foreground", "Base text and icon color.", "Foreground", preferences, actions),
    themeTextRow(prefix, "UI font", "Font stack used by chrome, sidebar, and controls.", "UiFont", preferences, actions),
    themeTextRow(prefix, "Editor font", "Font stack used by text and Markdown document surfaces.", "EditorFont", preferences, actions),
    themeRangeRow(prefix, "Translucent", "Window opacity mapping used by Writer-style glass.", "Translucent", preferences, actions),
    themeRangeRow(prefix, "Contrast", "Surface, border, hover, and selection strength.", "Contrast", preferences, actions),
  ];
  return <SettingsSection title={title} rows={rows} />;
}

function themeColorRow(
  prefix: ThemePrefix,
  label: string,
  description: string,
  suffix: "Accent" | "Background" | "Foreground",
  preferences: ViewerPreferences,
  actions: ShellActions,
) {
  const key = `${prefix}${suffix}` as ThemeColorKey;
  return colorPreferenceRow(
    label,
    description,
    String(preferences[key]),
    String(defaultPreferences[key]),
    (value) => actions.setPreference(key, value),
  );
}

function themeTextRow(
  prefix: ThemePrefix,
  label: string,
  description: string,
  suffix: "UiFont" | "EditorFont",
  preferences: ViewerPreferences,
  actions: ShellActions,
) {
  const key = `${prefix}${suffix}` as ThemeTextKey;
  return textPreferenceRow(
    label,
    description,
    String(preferences[key]),
    String(defaultPreferences[key]),
    (value) => actions.setPreference(key, value),
  );
}

function themeRangeRow(
  prefix: ThemePrefix,
  label: string,
  description: string,
  suffix: "Translucent" | "Contrast",
  preferences: ViewerPreferences,
  actions: ShellActions,
) {
  const key = `${prefix}${suffix}` as ThemeRangeKey;
  return rangePreferenceRow(
    label,
    description,
    Number(preferences[key]),
    Number(defaultPreferences[key]),
    (value) => actions.setPreference(key, value),
  );
}
