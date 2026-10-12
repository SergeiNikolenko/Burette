import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Element", "DOMRect", "DocumentFragment", "HTMLInputElement", "HTMLFormElement", "HTMLSelectElement", "Node", "NodeFilter", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { OnboardingHost, resetOnboarding } = await import("../apps/desktop/src/components/onboarding");
const { guideForState } = await import("../apps/desktop/src/components/onboarding/guides");
const initial = { page: "viewer", preferences: { theme: "auto" }, documents: [], recentStructures: [], sidebarProjects: [], tabs: [], activeDocument: null, activeTab: null } as unknown as ShellViewState;
const panel = () => document.querySelector('[role="dialog"]');
const title = () => panel()?.querySelector('[data-slot="dialog-title"]')?.textContent;
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label || item.getAttribute("aria-label") === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
};
const finishIntroduction = async () => { await click("Get started"); await click("Continue"); await click("Explore on my own"); };

async function mountOnboarding(state = initial, actionOverrides: Partial<ShellActions> = {}) {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const actions = { openSettingsSection: () => {}, setPreference: () => {}, chooseFiles: () => {}, openKetcher: () => {}, chooseWorkspace: () => {}, ...actionOverrides } as ShellActions;
  await act(async () => root.render(<OnboardingHost state={state} actions={actions} />));
  return { render: async (next: ShellViewState) => act(async () => root.render(<OnboardingHost state={next} actions={actions} />)),
    dispose: async () => { await act(async () => root.unmount()); mount.remove(); } };
}

test("first run has welcome, real appearance controls and three working start actions", async () => {
  for (const [button, action] of [["Open file", "chooseFiles"], ["Draw a molecule", "openKetcher"], ["Add folder", "chooseWorkspace"]] as const) {
    localStorage.clear();
    const calls: string[] = [];
    const themes: unknown[] = [];
    const view = await mountOnboarding(initial, { [action]: () => { calls.push(action); }, setPreference: (key, value) => { themes.push([key, value]); } });
    try {
      expect(title()).toBe("Welcome to Burette");
      expect(document.querySelector('[aria-label="Screen guide"]')).toBeNull();
      await click("Get started");
      expect(title()).toBe("Choose your appearance");
      await act(async () => document.querySelector<HTMLInputElement>('input[aria-label="Dark"]')!.click());
      expect(themes).toEqual([["theme", "dark"]]);
      await click("Continue");
      expect(title()).toBe("Start with a structure");
      await click(button);
      expect(calls).toEqual([action]);
      expect(panel()).toBeNull();
    } finally { await view.dispose(); }
  }
});

test("contextual education appears once per screen and survives remount", async () => {
  localStorage.clear();
  const view = await mountOnboarding();
  const sketch = { ...initial, activeTab: { location: { kind: "ketcher" } } } as ShellViewState;
  try {
    await finishIntroduction();
    await view.render(sketch);
    expect(title()).toBe("Draw a molecule");
    await click("Start drawing");
    expect(panel()).toBeNull();
    await view.render(initial); await view.render(sketch);
    expect(panel()).toBeNull();
    await view.render({ ...initial, activeTab: { location: { kind: "jobs" } } } as ShellViewState);
    expect(title()).toBe("Calculations");
    await click("Don't show tips");
    await view.render({ ...initial, activeTab: { location: { kind: "document", path: "/notes.pdf" } } } as ShellViewState);
    expect(panel()).toBeNull();
  } finally { await view.dispose(); }
  const restored = await mountOnboarding(sketch);
  try { expect(panel()).toBeNull(); } finally { await restored.dispose(); }
});

test("reset restarts welcome immediately and preserves workspace and preference storage", async () => {
  localStorage.clear();
  localStorage.setItem("burette.shell", '{"theme":"dark"}');
  localStorage.setItem("burette.molecule.session", '{"tabs":["protein"]}');
  localStorage.setItem("burette.screen-guides.v1", '{"automatic":true,"seen":["launcher"]}');
  const view = await mountOnboarding();
  try {
    expect(panel()).toBeNull();
    await act(async () => resetOnboarding());
    expect(title()).toBe("Welcome to Burette");
    expect(localStorage.getItem("burette.shell")).toBe('{"theme":"dark"}');
    expect(localStorage.getItem("burette.molecule.session")).toBe('{"tabs":["protein"]}');
    await click("Skip introduction");
    expect(panel()).toBeNull();
    await act(async () => resetOnboarding());
    expect(title()).toBe("Welcome to Burette");
  } finally { await view.dispose(); }
});

test("established workspaces and hosted workspaces are not interrupted", async () => {
  localStorage.clear();
  const existing = await mountOnboarding({ ...initial, recentStructures: [{ path: "/molecule.pdb" }] } as ShellViewState);
  try { expect(panel()).toBeNull(); } finally { await existing.dispose(); }
  localStorage.clear();
  window.__BURETTE_HOSTED_MCP_WIDGET__ = true;
  const embedded = await mountOnboarding();
  try { expect(panel()).toBeNull(); expect(localStorage.length).toBe(0); }
  finally { await embedded.dispose(); delete window.__BURETTE_HOSTED_MCP_WIDGET__; }
});

test("context CTA opens the real settings destination and Escape dismisses a visited screen", async () => {
  localStorage.clear();
  const calls: string[] = [];
  const view = await mountOnboarding(initial, { openSettingsSection: section => calls.push(section) });
  try {
    await finishIntroduction();
    await view.render({ ...initial, activeTab: { location: { kind: "settings", section: "general" } } } as ShellViewState);
    expect(title()).toBe("Make Burette yours");
    await click("Choose appearance");
    expect(calls).toEqual(["appearance"]);
    await view.render({ ...initial, activeTab: { location: { kind: "jobs" } } } as ShellViewState);
    expect(title()).toBe("Calculations");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(panel()).toBeNull();
  } finally { await view.dispose(); }
});

test("file renderer and agent settings get the relevant education screen", () => {
  for (const [renderer, expected] of [["molstar", "file"], ["grid2d", "grid"], ["spectrum", "spectrum"], ["xyzrender-external", "illustration"]]) {
    expect(guideForState({ ...initial, activeDocument: { renderer, extension: "pdb" } } as ShellViewState)).toBe(expected);
  }
  expect(guideForState({ ...initial, activeDocument: { renderer: "molstar", extension: "molj" } } as ShellViewState)).toBe("mesoscale");
  expect(guideForState({ ...initial, activeTab: { location: { kind: "settings", section: "agent" } } } as ShellViewState)).toBe("agent");
});
