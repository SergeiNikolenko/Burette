import { expect, spyOn, test } from "bun:test";
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
const { requestContextualGuide } = await import("../apps/desktop/src/components/onboarding/request");
const { claimContextualGuide, markContextualGuideSeen, releaseContextualGuide, readOnboardingProgress, saveOnboardingProgress } = await import("../apps/desktop/src/components/onboarding/progress");
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
  // The desktop app renders onboarding inside its shell, as here.
  const mount = document.createElement("main"); mount.className = "app-shell"; document.body.append(mount); const root = createRoot(mount);
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

test("navigation never opens contextual education after the welcome or on remount", async () => {
  localStorage.clear();
  const view = await mountOnboarding();
  const destinations = ["ketcher", "jobs", "settings", "document", "file"];
  try {
    await finishIntroduction();
    for (const kind of destinations) {
      await view.render({ ...initial, activeTab: { location: { kind } } } as ShellViewState);
      expect(panel()).toBeNull();
    }
    expect(readOnboardingProgress().seen).toEqual(["launcher"]);
  } finally { await view.dispose(); }
  const restored = await mountOnboarding({ ...initial, activeTab: { location: { kind: "ketcher" } } } as ShellViewState);
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

// The flag the native shell sets on a window it holds for the opening (vite-env.d.ts).
const heldWindow = window as typeof window & { __BURETTE_INTRO__?: boolean };
const drawableCanvas = () => {
  const gl = new Proxy({}, { get: (_, key) => key === "isContextLost" ? () => false : () => ({}) });
  return spyOn(browser.HTMLCanvasElement.prototype, "getContext").mockImplementation(() => gl as never);
};

test("a window held for the opening plays it first and continues the welcome at appearance", async () => {
  localStorage.clear();
  heldWindow.__BURETTE_INTRO__ = true;
  const webgl = drawableCanvas();
  // No frames arrive, so the clock stays still and Escape skips straight to the end.
  const frames = spyOn(browser, "requestAnimationFrame").mockImplementation(() => 0 as never);
  const view = await mountOnboarding();
  try {
    expect(panel()).toBeNull();
    expect(document.documentElement.dataset.buretteIntro).toBe("playing");
    // The shell is hidden while the opening plays, so the opening must not sit inside it.
    const opening = document.querySelector(".atom-intro");
    expect(opening !== null && opening.closest(".app-shell") === null).toBe(true);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await Bun.sleep(250); });
    await click("Get started");
    await act(() => Bun.sleep(500));
    expect(document.documentElement.dataset.buretteIntro).toBeUndefined();
    expect(title()).toBe("Choose your appearance");
  } finally { webgl.mockRestore(); frames.mockRestore(); await view.dispose(); delete heldWindow.__BURETTE_INTRO__; }
});

test("an opening that cannot play in front of the user hands over to the whole welcome without dimming", async () => {
  heldWindow.__BURETTE_INTRO__ = true;
  const cues: string[] = [];
  const invoke = async (command: string, args: { cue?: { kind: string } }) => {
    if (command !== "present_intro" || !args.cue) return;
    cues.push(args.cue.kind);
    if (args.cue.kind === "begin") throw "Burette is not the active application";
  };
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke } });
  try {
    localStorage.clear();
    const webgl = drawableCanvas();
    const background = await mountOnboarding();
    try { expect(title()).toBe("Welcome to Burette"); expect(cues).toEqual(["begin", "settle"]); }
    finally { webgl.mockRestore(); await background.dispose(); }
    // A canvas that cannot draw hands over before the shell is ever asked to dim.
    localStorage.clear();
    cues.length = 0;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const blank = await mountOnboarding();
    try { expect(title()).toBe("Welcome to Burette"); expect(cues).toEqual(["settle"]); expect(warn).toHaveBeenCalled(); }
    finally { warn.mockRestore(); await blank.dispose(); }
  } finally { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); delete heldWindow.__BURETTE_INTRO__; }
});

test("the empty recent list a first launch saves while booting still gets the welcome; a remembered structure does not", async () => {
  localStorage.clear();
  localStorage.setItem("burette.recent.structures", '{"revision":1,"documents":[]}');
  const fresh = await mountOnboarding();
  try { expect(title()).toBe("Welcome to Burette"); } finally { await fresh.dispose(); }
  localStorage.clear();
  localStorage.setItem("burette.recent.structures", JSON.stringify({ revision: 3, documents: [
    { path: "/Users/me/protein.pdb", title: "protein.pdb", extension: "pdb", renderer: "molstar", byteCount: 2048, openedAt: 1 }] }));
  const established = await mountOnboarding();
  try { expect(panel()).toBeNull(); } finally { await established.dispose(); }
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

test("Escape dismisses welcome and disables future automatic education", async () => {
  localStorage.clear();
  const view = await mountOnboarding();
  try {
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(panel()).toBeNull();
    expect(readOnboardingProgress()).toMatchObject({ enabled: false, welcomeCompleted: true });
    expect(claimContextualGuide("trajectory-smoothing")).toBe(false);
  } finally { await view.dispose(); }
});

const enableContextualGuides = () => {
  resetOnboarding();
  saveOnboardingProgress({ enabled: true, welcomeCompleted: true, seen: [] });
};

test("welcome completion preserves guidance recorded by another mounted feature", async () => {
  localStorage.clear();
  resetOnboarding();
  const view = await mountOnboarding();
  try {
    await click("Get started");
    await click("Continue");
    saveOnboardingProgress({ enabled: true, welcomeCompleted: true, seen: [] });
    expect(claimContextualGuide("trajectory-smoothing")).toBe(true);
    await click("Explore on my own");
    expect(readOnboardingProgress().seen).toEqual(["trajectory-smoothing", "launcher"]);
    expect(readOnboardingProgress().contextual?.count).toBe(1);
    releaseContextualGuide("trajectory-smoothing");
  } finally { await view.dispose(); }
});

test("feature claims persist immediately, and dismissal or release never makes a tip eligible again", () => {
  enableContextualGuides();
  expect(claimContextualGuide("trajectory-smoothing")).toBe(true);
  expect(readOnboardingProgress().seen).toEqual(["trajectory-smoothing"]);
  expect(JSON.parse(localStorage.getItem("burette.onboarding.v2")!).seen).toEqual(["trajectory-smoothing"]);
  markContextualGuideSeen("trajectory-smoothing");
  releaseContextualGuide("trajectory-smoothing");
  expect(claimContextualGuide("trajectory-smoothing")).toBe(false);
  expect(readOnboardingProgress().seen).toEqual(["trajectory-smoothing"]);
});

test("one active guide, persisted cooldown and daily budget limit contextual interruptions", () => {
  enableContextualGuides();
  let now = new Date("2026-10-13T12:00:00Z").getTime();
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    expect(claimContextualGuide("trajectory-smoothing")).toBe(true);
    now += 10 * 60 * 1000;
    expect(claimContextualGuide("pose-compare")).toBe(false);
    releaseContextualGuide("pose-compare");
    expect(claimContextualGuide("pose-compare")).toBe(false);
    releaseContextualGuide("trajectory-smoothing");
    now -= 1;
    expect(claimContextualGuide("pose-compare")).toBe(false);
    now += 1;
    expect(claimContextualGuide("pose-compare")).toBe(true);
    releaseContextualGuide("pose-compare");
    now += 10 * 60 * 1000;
    // Re-reading saved progress retains the limit across mounted feature controls.
    saveOnboardingProgress(readOnboardingProgress());
    expect(claimContextualGuide("scene-compose")).toBe(false);
    expect(readOnboardingProgress().seen).toEqual(["trajectory-smoothing", "pose-compare"]);
    now += 24 * 60 * 60 * 1000;
    expect(claimContextualGuide("scene-compose")).toBe(true);
    releaseContextualGuide("scene-compose");
  } finally { clock.mockRestore(); }
});

test("policy requires completed enabled onboarding and excludes hosted or established users", () => {
  resetOnboarding();
  expect(claimContextualGuide("trajectory-smoothing")).toBe(false);
  saveOnboardingProgress({ enabled: false, welcomeCompleted: true, seen: [] });
  expect(claimContextualGuide("trajectory-smoothing")).toBe(false);
  localStorage.clear();
  localStorage.setItem("burette.screen-guides.v1", '{"automatic":true}');
  expect(claimContextualGuide("trajectory-smoothing")).toBe(false);
  enableContextualGuides();
  window.__BURETTE_HOSTED_MCP_WIDGET__ = true;
  try { expect(claimContextualGuide("trajectory-smoothing")).toBe(false); }
  finally { delete window.__BURETTE_HOSTED_MCP_WIDGET__; }
  expect(readOnboardingProgress().seen).toEqual([]);
  localStorage.setItem("burette.onboarding.v2", "corrupt");
  expect(claimContextualGuide("trajectory-smoothing")).toBe(false);
});

test("reset clears active guide, seen, cooldown and budget and requires welcome again", () => {
  enableContextualGuides();
  expect(claimContextualGuide("trajectory-smoothing")).toBe(true);
  resetOnboarding();
  expect(readOnboardingProgress()).toMatchObject({ enabled: true, welcomeCompleted: false, seen: [] });
  expect(readOnboardingProgress().contextual).toBeUndefined();
  expect(claimContextualGuide("trajectory-smoothing")).toBe(false);
  saveOnboardingProgress({ ...readOnboardingProgress(), welcomeCompleted: true });
  expect(claimContextualGuide("trajectory-smoothing")).toBe(true);
  releaseContextualGuide("trajectory-smoothing");
});

test("a requested guide opens once beside its control, pages through, and closes", async () => {
  localStorage.clear();
  saveOnboardingProgress({ enabled: true, welcomeCompleted: true, seen: [] });
  const view = await mountOnboarding();
  const anchor = document.createElement("button"); document.body.append(anchor);
  try {
    await act(async () => { expect(requestContextualGuide("grid", anchor)).toBe(true); });
    expect(panel()?.textContent).toContain("Look at the molecules");
    expect(panel()?.querySelector("img")?.getAttribute("src")).toBe("/onboarding/guides/collection-cards.webp");
    await click("Next");
    expect(panel()?.textContent).toContain("Compare properties");
    await click("Done");
    expect(panel()).toBeNull();
    expect(requestContextualGuide("grid", anchor)).toBe(false);
    expect(readOnboardingProgress().seen).toEqual(["grid"]);
  } finally { anchor.remove(); await view.dispose(); }
});

test("an announcement or an unanchored guide opens as a dialog", async () => {
  localStorage.clear();
  saveOnboardingProgress({ enabled: true, welcomeCompleted: true, seen: [] });
  const view = await mountOnboarding();
  try {
    await act(async () => { expect(requestContextualGuide("ketcher")).toBe(true); });
    expect(title()).toBe("Meet Ketcher");
    await click("Got it");
    expect(panel()).toBeNull();
  } finally { await view.dispose(); }
});

test("guides are not requested without a mounted host", () => {
  localStorage.clear();
  saveOnboardingProgress({ enabled: true, welcomeCompleted: true, seen: [] });
  expect(requestContextualGuide("grid")).toBe(false);
  expect(readOnboardingProgress().seen).toEqual([]);
});
