import { useState } from "react";
import { resolveAppearanceTheme, resolveThemeMode, useSystemThemeMode } from "../../lib/theme";
import { CHATGPT_ACCENTS, chatgptAccentName, codexAccent, chatgptAccentSwatch, chatgptAccentValue, CODEX_DEFAULT_THEME, type ChatgptAccent } from "../../lib/codex-theme";
import type { ViewerPreferences } from "../../types";
import { defaultPreferences } from "../../stores/settings-store";
import type { ShellActions } from "../types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronRight } from "@/components/ui/app-icons";
import { interfaceScaleRow } from "./app-settings-sections";
import { ThemeModeControl } from "./theme-mode-control";
import {
  ColorControl,
  SelectControl,
  SettingControl,
  SettingsSection,
  TextControl,
  colorPreferenceRow,
  rangePreferenceRow,
  selectPreferenceRow,
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
type ThemeFontKey =
  | "themeLightUiFont"
  | "themeLightEditorFont"
  | "themeDarkUiFont"
  | "themeDarkEditorFont";
type ThemeRangeKey =
  | "themeLightTranslucent"
  | "themeLightContrast"
  | "themeDarkTranslucent"
  | "themeDarkContrast";

// Codex AppearanceSettings: a "Visual style" card with the mode picker, an
// untitled card for the active mode's theme, and a collapsed Advanced section.
export function AppearanceSettings({
  preferences,
  actions,
}: {
  preferences: ViewerPreferences;
  actions: ShellActions;
}) {
  const mode = resolveThemeMode(preferences.theme, useSystemThemeMode());
  const prefix: ThemePrefix = mode === "light" ? "themeLight" : "themeDark";
  return (
    <>
      <section className="settings-section settings-section-joined">
        <h2>Visual style</h2>
        <Card className="settings-card">
          <SettingControl row={{
            label: "Mode",
            control: <ThemeModeControl value={preferences.theme} onChange={(theme) => actions.setPreference("theme", theme)} />,
          }} />
        </Card>
      </section>
      <SettingsSection title="Theme" hideTitle rows={[
        accentRow(mode, prefix, preferences, actions),
        themeColorRow(mode, prefix, "Background", preferences, actions),
        themeColorRow(mode, prefix, "Foreground", preferences, actions),
        themeFontRow("Font", `${prefix}UiFont`, preferences, actions),
      ]} />
      <AdvancedSection rows={[
        interfaceScaleRow(preferences, actions.setPreference),
        selectPreferenceRow(
          "Canvas",
          "",
          preferences.canvasBackground,
          ["auto", "black", "graphite", "white", "transparent"],
          defaultPreferences.canvasBackground,
          (canvasBackground) => actions.setPreference("canvasBackground", canvasBackground as ViewerPreferences["canvasBackground"]),
          { auto: "Match theme", black: "Black", graphite: "Graphite", white: "White", transparent: "Transparent" },
        ),
        themeFontRow("Code font", `${prefix}EditorFont`, preferences, actions),
        themeRangeRow(mode, "Translucency", `${prefix}Translucent`, preferences, actions),
        themeRangeRow(mode, "Contrast", `${prefix}Contrast`, preferences, actions),
      ]} />
    </>
  );
}

function AdvancedSection({ rows }: { rows: SettingRow[] }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="settings-section">
      <h2>
        <button type="button" className="settings-section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          Advanced
          <Chevron size={14} aria-hidden />
        </button>
      </h2>
      {open ? (
        <Card className="settings-card">
          {rows.map((row) => <SettingControl key={row.label} row={row} />)}
        </Card>
      ) : null}
    </section>
  );
}

function themeColorRow(
  mode: ThemeMode,
  prefix: ThemePrefix,
  suffix: "Background" | "Foreground",
  preferences: ViewerPreferences,
  actions: ShellActions,
) {
  const key = `${prefix}${suffix}` as ThemeColorKey;
  const theme = resolveAppearanceTheme(preferences, mode);
  const field = { Background: "surface", Foreground: "ink" } as const;
  return colorPreferenceRow(
    suffix,
    "",
    theme[field[suffix]],
    CODEX_DEFAULT_THEME[mode][field[suffix]],
    (value) => actions.setPreference(key, value),
  );
}

const ACCENT_LABELS: Record<ChatgptAccent, string> = {
  default: "Default", blue: "Blue", green: "Green", yellow: "Yellow", pink: "Pink", orange: "Orange", purple: "Purple", black: "White",
};

// Codex accent menu: ChatGPT's named accents, or Custom with a color field.
function accentRow(mode: ThemeMode, prefix: ThemePrefix, preferences: ViewerPreferences, actions: ShellActions): SettingRow {
  const key = `${prefix}Accent` as ThemeColorKey;
  const theme = resolveAppearanceTheme(preferences, mode);
  const setAccent = (value: string) => actions.setPreference(key, value);
  return {
    label: "Accent",
    // "Default" in the menu is the reset.
    control: <AccentControl mode={mode} value={theme.accent} effective={codexAccent(theme, mode)} named={chatgptAccentName(theme, mode)} onChange={setAccent} />,
  };
}

function AccentControl({ mode, value, effective, named, onChange }: {
  mode: ThemeMode;
  value: string;
  effective: string;
  named: ChatgptAccent | null;
  onChange: (value: string) => void;
}) {
  const [custom, setCustom] = useState(named === null);
  const selected = custom || named === null ? "custom" : named;
  const swatch = (name: ChatgptAccent) => (
    <span className="settings-accent-swatch" style={{ backgroundColor: chatgptAccentSwatch(name, mode) }} aria-hidden />
  );
  return (
    <div className="settings-font-control">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Accent" className="settings-select justify-between" variant="outline" size="settings">
            {selected === "custom" ? null : swatch(selected)}
            <span className="min-w-0 truncate">{selected === "custom" ? "Custom" : ACCENT_LABELS[selected]}</span>
            <ChevronDown size={14} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuRadioGroup value={selected} onValueChange={(next) => {
            setCustom(next === "custom");
            // Custom starts from the accent currently on screen, as in Codex.
            onChange(next === "custom" ? effective : chatgptAccentValue(next as ChatgptAccent, mode));
          }}>
            {CHATGPT_ACCENTS.map((name) => (
              <DropdownMenuRadioItem key={name} value={name}>{swatch(name)}{ACCENT_LABELS[name]}</DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value="custom">Custom</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {selected === "custom" ? <ColorControl label={`${mode === "dark" ? "Dark" : "Light"} custom accent`} value={value} onChange={onChange} /> : null}
    </div>
  );
}

// Codex offers the system stack or a custom font value; the stack itself is
// never shown.
function themeFontRow(
  label: string,
  key: ThemeFontKey,
  preferences: ViewerPreferences,
  actions: ShellActions,
): SettingRow {
  const value = String(preferences[key]);
  const systemValue = String(defaultPreferences[key]);
  return {
    label,
    control: <FontControl label={label} value={value} systemValue={systemValue} onChange={(next) => actions.setPreference(key, next)} />,
    reset: () => actions.setPreference(key, systemValue),
    isModified: value !== systemValue,
  };
}

function FontControl({
  label,
  value,
  systemValue,
  onChange,
}: {
  label: string;
  value: string;
  systemValue: string;
  onChange: (value: string) => void;
}) {
  const [custom, setCustom] = useState(value !== systemValue);
  return (
    <div className="settings-font-control">
      {custom ? <TextControl label={`Custom ${label.toLowerCase()}`} value={value === systemValue ? "" : value} placeholder="Font family" onChange={(next) => onChange(next.trim() ? next : systemValue)} /> : null}
      <SelectControl
        label={label}
        value={custom ? "custom" : "system"}
        options={["system", "custom"]}
        labels={{ system: "System", custom: "Use custom font value" }}
        onChange={(next) => {
          setCustom(next === "custom");
          if (next === "system") onChange(systemValue);
        }}
      />
    </div>
  );
}

function themeRangeRow(
  mode: ThemeMode,
  label: string,
  key: ThemeRangeKey,
  preferences: ViewerPreferences,
  actions: ShellActions,
) {
  const contrast = key.endsWith("Contrast");
  return rangePreferenceRow(
    label,
    "",
    contrast ? resolveAppearanceTheme(preferences, mode).contrast : preferences[key],
    contrast ? CODEX_DEFAULT_THEME[mode].contrast : defaultPreferences[key],
    (value) => actions.setPreference(key, value),
  );
}
