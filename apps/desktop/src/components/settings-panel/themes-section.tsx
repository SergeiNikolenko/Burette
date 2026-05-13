import type { ShellThemeValues, ViewerPreferences } from "../../types";
import { SettingsSection, colorRow, rangeRow, type SettingRow } from "./setting-control";

function themeRows(
  value: ShellThemeValues,
  defaultValue: ShellThemeValues,
  onChange: (value: ShellThemeValues) => void,
): SettingRow[] {
  return [
    colorRow("Accent", "Primary action and link color.", value.accent, defaultValue.accent, (accent) =>
      onChange({ ...value, accent }),
    ),
    colorRow("Background", "Base window background color.", value.background, defaultValue.background, (background) =>
      onChange({ ...value, background }),
    ),
    colorRow("Foreground", "Primary text and icon color.", value.foreground, defaultValue.foreground, (foreground) =>
      onChange({ ...value, foreground }),
    ),
    rangeRow(
      "Translucent",
      "Window material opacity.",
      value.backgroundOpacity,
      defaultValue.backgroundOpacity,
      0.4,
      1,
      0.005,
      (backgroundOpacity) => onChange({ ...value, backgroundOpacity }),
    ),
    rangeRow(
      "Contrast",
      "Derived surface and border intensity.",
      value.contrast,
      defaultValue.contrast,
      0.1,
      0.7,
      0.001,
      (contrast) => onChange({ ...value, contrast }),
    ),
  ];
}

export function ThemesSection({
  preferences,
  defaults,
  onChange,
}: {
  preferences: ViewerPreferences;
  defaults: ViewerPreferences;
  onChange: (preferences: ViewerPreferences["themeOverrides"]) => void;
}) {
  return (
    <>
      {(["light", "dark"] as const).map((mode) => (
        <SettingsSection
          key={mode}
          title={mode === "light" ? "Light Theme" : "Dark Theme"}
          rows={themeRows(
            preferences.themeOverrides[mode],
            defaults.themeOverrides[mode],
            (next) =>
              onChange({
                ...preferences.themeOverrides,
                [mode]: next,
              }),
          )}
        />
      ))}
    </>
  );
}
