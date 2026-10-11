import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { defaultPreferences } from "../apps/desktop/src/stores/settings-store";
import { previewBackgroundStyle, viewerAppearanceMessage } from "../apps/desktop/src/lib/theme";

const preferences = { ...defaultPreferences, theme: "light" as const, themeLightBackground: "#e7ebef", themeDarkBackground: "#253147" };

test("new and remounted frames receive both palettes and preserve explicit backgrounds", () => {
  const message = viewerAppearanceMessage({ ...preferences, canvasBackground: "graphite" });
  expect({ type: message.type, value: message.value, canvas: message.canvasBackground,
    light: message.themeTokens.light.background, dark: message.themeTokens.dark.background }).toEqual({
    type: "setViewerTheme", value: "light", canvas: "graphite", light: "#e7ebef", dark: "#253147",
  });
  expect(previewBackgroundStyle(preferences)).toContain("background:#e7ebef");
  expect(previewBackgroundStyle({ ...preferences, theme: "auto" })).toBe("html{color-scheme:light dark;background:#253147}body{background:inherit}@media(prefers-color-scheme:light){html{background:#e7ebef}}");
  for (const [canvasBackground, color] of [["graphite", "#111111"], ["black", "#000000"], ["white", "#ffffff"], ["transparent", "transparent"]] as const) {
    expect(previewBackgroundStyle({ ...preferences, canvasBackground })).toContain(`background:${color}`);
  }
});

test("mounted Molstar receives appearance in place, including old theme-only messages", () => {
  const source = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("    if (body.type === 'setViewerTheme')"), source.indexOf("    // Settings own the default Mol* appearance."));
  const config: Record<string, unknown> = { theme: "dark", canvasBackground: "white" };
  const viewer = { scene: "unsaved" };
  const parent = {};
  const calls: unknown[] = [];
  const context = { window: { parent, BuretteConfig: config }, activeConfig: config, activeViewer: viewer,
    canvasBackground: "white", event: { source: parent },
    normalizeViewerTheme: (value: string) => value, normalizeCanvasBackground: (value: string) => value,
    setViewerTheme: (...args: unknown[]) => calls.push(args), body: viewerAppearanceMessage(preferences) };
  runInNewContext(`(function(){${handler}})()`, context);
  expect(config).toEqual({ theme: "light", canvasBackground: "auto", transparentBackground: false, themeTokens: context.body.themeTokens });
  expect(calls).toEqual([["light", viewer]]);
  context.body = { type: "setViewerTheme", value: "dark" } as typeof context.body;
  context.canvasBackground = "white";
  runInNewContext(`(function(){${handler}})()`, context);
  expect(context.canvasBackground).toBe("white");
  context.event.source = {};
  runInNewContext(`(function(){${handler}})()`, context);
  expect(calls).toHaveLength(2);
});

test("grid appearance updates in place and clears previous transparency", () => {
  const source = readFileSync(new URL("../PreviewExtension/Web/grid-viewer.js", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("      if (body.type === 'setViewerTheme')"), source.indexOf("      if (Object.hasOwn(GRID_APP_DEFAULT_MESSAGES"));
  const config = { canvasBackground: "transparent", transparentBackground: true };
  const parent = {};
  const calls: unknown[] = [];
  runInNewContext(`(function(){${handler}})()`, { window: { parent }, event: { source: parent },
    body: viewerAppearanceMessage(preferences), safeConfig: () => config,
    normalizeCanvasBackground: (value: string) => value, applyTheme: (value: unknown) => calls.push(value) });
  expect(config).toEqual({ canvasBackground: "auto", transparentBackground: false, theme: "light", themeTokens: viewerAppearanceMessage(preferences).themeTokens });
  expect(calls).toEqual([config]);
});
