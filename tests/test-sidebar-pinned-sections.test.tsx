import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
import type { SidebarProject } from "../apps/desktop/src/lib/sidebar-projects";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { FileBrowser } = await import("../apps/desktop/src/components/sidebar/file-browser");
const { TooltipProvider } = await import("../apps/desktop/src/components/ui/tooltip");

test("folders move between Pinned and Projects without duplicate root rows; collapse and search keep working", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const folder = (title: string): SidebarProject => ({ id: `project:/fixtures/${title}`, rootPath: `/fixtures/${title}`, title,
    subtitle: null, isExplicit: true, isPinned: false, isActive: false, items: [], matchText: title.toLowerCase() });
  let projects = [folder("Samples"), folder("Collections")];
  const state = { buildInfo: {}, documents: [], projectNameOverrides: {}, expandedProjectIds: [], sidebarQuery: "", projectsOpen: true };
  const actions = new Proxy({}, { get: (_, key) => key === "togglePinnedProjectRoot" ? (path: string) => {
    projects = projects.map(p => p.rootPath === path ? { ...p, isPinned: !p.isPinned } : p);
  } : () => {} }) as ShellActions;
  const render = async (query = "") => { await act(async () => root.render(<TooltipProvider><FileBrowser
    state={{ ...state, sidebarProjects: projects, sidebarQuery: query } as ShellViewState} actions={actions} /></TooltipProvider>)); };
  const rows = () => Object.fromEntries(Array.from(host.querySelectorAll('section[aria-label="Pinned"], section[aria-label="Projects"]')).map(section => [
    section.getAttribute("aria-label"), Array.from(section.querySelectorAll('.project-group-title')).map(row => row.textContent),
  ]));
  const click = async (label: string) => { await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()); await render(); };
  try {
    await render(); expect(rows()).toEqual({ Projects: ["Samples", "Collections"] });
    // The parent tree row must not cancel native button activation.
    for (const key of ["Enter", " "]) {
      const pin = host.querySelector<HTMLButtonElement>('button[aria-label="Pin Collections"]')!;
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await act(async () => { pin.focus(); pin.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false);
    }
    await click("Pin Collections"); expect(rows()).toEqual({ Pinned: ["Collections"], Projects: ["Samples"] });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-controls="sidebar-pinned-tree"]')!.click());
    expect(rows()).toEqual({ Pinned: [], Projects: ["Samples"] });
    await render("collections"); expect(rows()).toEqual({ Pinned: ["Collections"], Projects: [] });
    await click("Unpin Collections"); expect(rows()).toEqual({ Projects: ["Samples", "Collections"] });
    await click("Pin Samples"); await click("Pin Collections");
    await render("collections"); expect(rows()).toEqual({ Pinned: ["Collections"], Projects: [] });
  } finally { await act(async () => root.unmount()); host.remove(); }
});
