import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellViewState } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Element", "DOMRect", "DocumentFragment", "HTMLInputElement", "HTMLFormElement", "HTMLSelectElement", "Node", "NodeFilter", "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { ScreenGuide } = await import("../apps/desktop/src/components/onboarding");
const { guideForState } = await import("../apps/desktop/src/components/onboarding/guides");
const storageKey = "burette.screen-guides.v1";
const initial = { page: "viewer", documents: [], recentStructures: [], sidebarProjects: [], tabs: [], activeDocument: null, activeTab: null } as unknown as ShellViewState;
const actions = { openSettingsSection: () => {} };
const guidePanel = () => document.querySelector('[data-slot="popover-content"]');
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label || item.getAttribute("aria-label") === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
};

async function mountGuide(state = initial) {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  await act(async () => root.render(<ScreenGuide state={state} actions={actions} />));
  return { render: async (next: ShellViewState) => act(async () => root.render(<ScreenGuide state={next} actions={actions} />)),
    dispose: async () => { await act(async () => root.unmount()); mount.remove(); } };
}

test("first visit can be dismissed, reopened and stays dismissed after remount", async () => {
  localStorage.clear();
  const view = await mountGuide();
  expect(guidePanel()?.textContent).toContain("Getting started");
  expect(guidePanel()?.querySelectorAll("li")).toHaveLength(3);
  await click("Got it");
  expect(guidePanel()).toBeNull();
  await click("Screen guide");
  expect(guidePanel()?.textContent).toContain("Getting started");
  await click("Got it");
  await view.dispose();
  const restored = await mountGuide();
  expect(guidePanel()).toBeNull();
  await restored.dispose();
});

test("new screens receive one contextual hint; disabling automatic tips preserves manual help", async () => {
  localStorage.clear();
  const view = await mountGuide();
  await click("Got it");
  const sketch = { ...initial, activeTab: { location: { kind: "ketcher" } } } as ShellViewState;
  await view.render(sketch);
  expect(guidePanel()?.textContent).toContain("Draw a molecule");
  await act(async () => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  await click("Got it");
  await view.render({ ...initial, activeTab: { location: { kind: "jobs" } } } as ShellViewState);
  expect(guidePanel()).toBeNull();
  await click("Screen guide");
  expect(guidePanel()?.textContent).toContain("Calculations");
  await view.dispose();
  expect(JSON.parse(localStorage.getItem(storageKey)!).automatic).toBe(false);
});

test("existing work and embedded surfaces are not interrupted", async () => {
  localStorage.clear();
  const existing = await mountGuide({ ...initial, recentStructures: [{ path: "/molecule.pdb" }] } as ShellViewState);
  expect(guidePanel()).toBeNull();
  await click("Screen guide");
  expect(guidePanel()).not.toBeNull();
  await existing.dispose();
  localStorage.clear();
  window.__BURETTE_HOSTED_MCP_WIDGET__ = true;
  const embedded = await mountGuide();
  expect(document.querySelector('[aria-label="Screen guide"]')).toBeNull();
  expect(localStorage.getItem(storageKey)).toBeNull();
  await embedded.dispose();
  delete window.__BURETTE_HOSTED_MCP_WIDGET__;
});

test("file renderer and agent settings get the relevant guide", () => {
  for (const [renderer, expected] of [["molstar", "file"], ["grid2d", "grid"], ["spectrum", "spectrum"], ["xyzrender-external", "illustration"]]) {
    expect(guideForState({ ...initial, activeDocument: { renderer, extension: "pdb" } } as ShellViewState)).toBe(expected);
  }
  expect(guideForState({ ...initial, activeDocument: { renderer: "molstar", extension: "molj" } } as ShellViewState)).toBe("mesoscale");
  expect(guideForState({ ...initial, activeTab: { location: { kind: "settings", section: "agent" } } } as ShellViewState)).toBe("agent");
});
