import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window();
for (const key of ["CSS", "window", "document", "navigator", "DocumentFragment", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { StructureInfoPanel } = await import("../apps/desktop/src/components/structure-info-panel");
const { saveOnboardingProgress, resetOnboarding } = await import("../apps/desktop/src/components/onboarding/progress");
const { writeBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { DEFAULT_CONFORMER_SETTINGS, DEFAULT_XTB_SETTINGS } = await import("../apps/desktop/src/lib/chemistry-settings");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");

test("smoothing explains first deliberate opening, dismisses once, and respects reset", async () => {
  localStorage.clear();
  saveOnboardingProgress({ enabled: true, welcomeCompleted: true, seen: [] });
  const trajectory = { id: "smoothing-education", title: "trajectory.xyz", path: "/education/trajectory.xyz", extension: "xyz", renderer: "molstar", virtual: true, runtimePath: "/trajectory.html" } as ViewerDocument;
  writeBrowserDevVirtualTextDocument(trajectory.path, readFileSync(new URL("../samples/trajectory.xyz", import.meta.url), "utf8"));
  const props: React.ComponentProps<typeof StructureInfoPanel> = {
    document: trajectory, gridFilterModel: null, dockDrops: [], conformerStatus: null, conformerSettings: DEFAULT_CONFORMER_SETTINGS,
    viewerLigandSelection: null, structureOverlayMode: "all", xtbStatus: null, xtbSettings: DEFAULT_XTB_SETTINGS, xtbJobs: [],
    preferences: defaultPreferences, isBrowserDev: true, actions: { runStructureViewerAction: () => {} } as unknown as ShellActions,
  };
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const section = () => mount.querySelector<HTMLDetailsElement>(".trajectory-smoothing-card")!;
  const hint = () => mount.querySelector('[role="note"][aria-label="About smoothing"]');
  const toggle = async () => act(async () => { section().open = !section().open; section().dispatchEvent(new Event("toggle", { bubbles: true })); });
  try {
    await act(async () => root.render(<StructureInfoPanel {...props} />));
    expect(section().open).toBe(false);
    expect(hint()).toBeNull();
    await toggle();
    expect(hint()?.textContent).toContain("Off restores the original frames.");
    expect(hint()?.querySelector("video")?.getAttribute("src")).toBe("/onboarding/guides/trajectory-aligned.mp4");
    expect(mount.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => Array.from(hint()!.querySelectorAll("button")).find(button => button.textContent === "Got it")!.click());
    expect(hint()).toBeNull();
    await toggle(); await toggle();
    expect(hint()).toBeNull();
    await act(async () => resetOnboarding());
    await toggle(); await toggle();
    expect(hint()).toBeNull(); // Welcome must be completed before contextual education resumes.
  } finally {
    await act(async () => root.unmount()); mount.remove();
    deleteBrowserDevVirtualTextDocument(trajectory.path); localStorage.clear();
  }
});
