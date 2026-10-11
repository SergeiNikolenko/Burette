import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPreferences } from "../apps/desktop/src/stores/settings-store";
import { buildThemeStyle, readPreviewThemeTokens, resolveAppearanceTheme } from "../apps/desktop/src/lib/theme";
import { AppearanceSettings } from "../apps/desktop/src/components/settings-panel/themes-section";
import type { ShellActions } from "../apps/desktop/src/components/types";

test("appearance controls show the same resolved defaults as the rendered shell", () => {
  for (const mode of ["light", "dark"] as const) {
    // The theme card edits the active mode, as in Codex.
    const html = renderToStaticMarkup(<AppearanceSettings preferences={{ ...defaultPreferences, theme: mode }} actions={{} as ShellActions} />);
    const theme = resolveAppearanceTheme(defaultPreferences, mode);
    const preview = readPreviewThemeTokens(defaultPreferences, mode);
    expect({ accent: preview.accent, surface: preview.background, ink: preview.foreground, contrast: preview.contrast }).toEqual(theme);
    // An untouched accent follows ChatGPT's default accent, as in Codex desktop.
    const style = buildThemeStyle({ ...defaultPreferences, theme: mode }) as Record<string, string>;
    expect([style["--accent"], style["--bg-base"], style["--fg-base"]]).toEqual(["#3a83f7", theme.surface, theme.ink]);
    expect(html).toContain(">Default<");
    for (const value of [theme.surface, theme.ink]) expect(html).toContain(`value="${value.toUpperCase()}"`);
    expect(html).not.toContain('settings-control-description');
    expect(html).not.toContain('value="#AF52DE"');
    expect(html).not.toContain("-apple-system-body");
  }
});

test("custom colors and contrast remain visible and drive the shell", () => {
  const preferences = { ...defaultPreferences, themeDarkBackground: "#253147", themeDarkAccent: "#f28c28", themeDarkContrast: 72 };
  expect(resolveAppearanceTheme(preferences, "dark")).toEqual({ accent: "#f28c28", surface: "#253147", ink: "#ffffff", contrast: 72 });
  expect(readPreviewThemeTokens(preferences, "dark").contrast).toBe(72);
  const html = renderToStaticMarkup(<AppearanceSettings preferences={{ ...preferences, theme: "dark" }} actions={{} as ShellActions} />);
  expect(html).toContain('value="#253147"');
  expect(html).toContain('value="#F28C28"');
});
