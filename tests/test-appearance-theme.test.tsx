import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPreferences } from "../apps/desktop/src/stores/settings-store";
import { buildThemeStyle, resolveAppearanceTheme } from "../apps/desktop/src/lib/theme";
import { ThemesSection } from "../apps/desktop/src/components/settings-panel/themes-section";
import type { ShellActions } from "../apps/desktop/src/components/types";

test("appearance controls show the same resolved defaults as the rendered shell", () => {
  const html = renderToStaticMarkup(<ThemesSection preferences={defaultPreferences} actions={{} as ShellActions} />);
  for (const mode of ["light", "dark"] as const) {
    const theme = resolveAppearanceTheme(defaultPreferences, mode);
    const style = buildThemeStyle({ ...defaultPreferences, theme: mode }) as Record<string, string>;
    expect([style["--accent"], style["--bg-base"], style["--fg-base"]]).toEqual([theme.accent, theme.surface, theme.ink]);
    for (const value of [theme.accent, theme.surface, theme.ink]) expect(html).toContain(`value="${value.toUpperCase()}"`);
    expect(html.includes(`<span>${theme.contrast}</span>`)).toBe(true);
  }
  expect(html).not.toContain('settings-control-description');
  expect(html).not.toContain('value="#AF52DE"');
});

test("custom colors and contrast remain visible and drive the shell", () => {
  const preferences = { ...defaultPreferences, themeDarkBackground: "#253147", themeDarkAccent: "#f28c28", themeDarkContrast: 72 };
  expect(resolveAppearanceTheme(preferences, "dark")).toEqual({ accent: "#f28c28", surface: "#253147", ink: "#ffffff", contrast: 72 });
  const html = renderToStaticMarkup(<ThemesSection preferences={preferences} actions={{} as ShellActions} />);
  expect(html).toContain('value="#253147"');
  expect(html).toContain('value="#F28C28"');
  expect(html.includes("<span>72</span>")).toBe(true);
});
