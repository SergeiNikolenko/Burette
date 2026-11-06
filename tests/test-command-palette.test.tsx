import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "DocumentFragment", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { CommandPalette } = await import("../apps/desktop/src/components/command-palette");
const { useUIStore } = await import("../apps/desktop/src/stores/ui-store");
const { useIsCommandPaletteOpen } = await import("../apps/desktop/src/hooks/use-command-palette");

test("palette typing reuses project entries and leaves the shell outside the query subscription", async () => {
  let shellRenders = 0;
  let projectReads = 0;
  const opened: string[] = [];
  const items = Array.from({ length: 40 }, (_, index) => ({
    source: "project", path: `/project/ligand-${index}.sdf`, relativePath: `ligand-${index}.sdf`,
    get title() { projectReads++; return `Ligand ${index}`; },
    renderer: "molstar", extension: "sdf", byteCount: 100, documentId: `document-${index}`,
  }));
  const state = { sidebarProjects: [{ title: "Project", items }], preferences: { rendererMode: "auto" } } as unknown as ShellViewState;
  const actions = { selectDocument: (id: string) => opened.push(id) } as unknown as ShellActions;
  function Shell() {
    shellRenders++;
    const open = useIsCommandPaletteOpen();
    return <CommandPalette state={state} actions={actions} isOpen={open} onClose={() => useUIStore.getState().closeCommandPalette()} onRunError={error => { throw error; }} />;
  }
  useUIStore.getState().openCommandPalette();
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () => root.render(<Shell />));
    const initial = { shellRenders, projectReads };
    const input = document.querySelector<HTMLInputElement>('[aria-label="Search commands and open structures"]')!;
    for (const query of ["l", "lig", "ligand"]) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect({ shellRenders, projectReads }).toEqual(initial);
    expect(useUIStore.getState().commandPaletteSearch).toBe("ligand");
    expect(document.querySelectorAll('[cmdk-item][data-value^="project-"]')).toHaveLength(40);
    await act(async () => { useUIStore.getState().setCommandPaletteSearch("ligand 39"); });
    const result = document.querySelector<HTMLElement>('[cmdk-item]')!;
    expect(result.textContent).toContain("Ligand 39");
    await act(async () => result.click());
    expect(opened).toEqual(["document-39"]);
    expect(useUIStore.getState().isCommandPaletteOpen).toBe(false);
  } finally {
    await act(async () => root.unmount()); mount.remove();
    useUIStore.getState().closeCommandPalette();
  }
});

test("large search results stay bounded and keyboard navigation reaches every result", async () => {
  const opened: string[] = [];
  const items = Array.from({ length: 1000 }, (_, index) => ({
    source: "project", path: `/project/candidate-${index}.pdb`, relativePath: `candidate-${index}.pdb`,
    title: `Candidate ${index}`, renderer: "molstar", extension: "pdb", byteCount: 100, documentId: `document-${index}`,
  }));
  const state = { sidebarProjects: [{ title: "Project", items }], preferences: { rendererMode: "auto" } } as unknown as ShellViewState;
  const actions = { selectDocument: (id: string) => opened.push(id) } as unknown as ShellActions;
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  useUIStore.getState().openCommandPalette();
  try {
    await act(async () => root.render(<CommandPalette state={state} actions={actions} isOpen onClose={() => {}} onRunError={error => { throw error; }} />));
    const input = document.querySelector<HTMLInputElement>('[cmdk-input]')!;
    input.focus();
    const search = async (query: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const key = async (key: string, extra = {}) => act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra })));
    const selected = () => document.getElementById(input.getAttribute("aria-activedescendant")!)!;
    await search("candidate");
    expect(document.querySelector('[cmdk-input]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(document.querySelectorAll('[cmdk-item]').length).toBeLessThan(30);
    expect([selected().getAttribute("aria-posinset"), selected().getAttribute("aria-setsize")]).toEqual(["1", "1000"]);
    await key("End");
    expect(selected().textContent).toContain("Candidate 999");
    expect(selected().getAttribute("aria-selected")).toBe("true");
    const removedState = { ...state, sidebarProjects: [{ ...state.sidebarProjects[0], items: items.slice(0, -1) }] } as unknown as ShellViewState;
    await act(async () => root.render(<CommandPalette state={removedState} actions={actions} isOpen onClose={() => {}} onRunError={error => { throw error; }} />));
    expect([selected().getAttribute("aria-posinset"), selected().getAttribute("aria-selected")]).toEqual(["1", "true"]);
    await act(async () => root.render(<CommandPalette state={state} actions={actions} isOpen onClose={() => {}} onRunError={error => { throw error; }} />));
    await key("End");
    await key("ArrowUp"); expect(selected().textContent).toContain("Candidate 998");
    await key("Home"); expect(selected().getAttribute("aria-posinset")).toBe("1");
    await key("PageDown"); expect(Number(selected().getAttribute("aria-posinset"))).toBeGreaterThan(10);
    await key("PageUp"); expect(selected().getAttribute("aria-posinset")).toBe("1");
    for (let index = 0; index < 35; index++) await key("ArrowDown");
    expect(selected().textContent).toContain("Candidate 35");
    expect(document.querySelectorAll('[cmdk-item]').length).toBeLessThan(30);
    const list = document.querySelector<HTMLElement>('[cmdk-list]')!;
    await act(async () => { list.scrollTop = 20000; list.dispatchEvent(new Event("scroll")); });
    expect(selected().textContent).toContain("Candidate 35");
    expect(document.querySelectorAll('[cmdk-item]').length).toBeLessThan(30);
    const scrolledResult = [...document.querySelectorAll<HTMLElement>('[cmdk-item]')].find(item => Number(item.getAttribute("aria-posinset")) > 600)!;
    await act(async () => scrolledResult.click());
    expect(opened).toEqual([`document-${Number(scrolledResult.getAttribute("aria-posinset")) - 1}`]);
    opened.length = 0;
    await key("End"); await key("Enter"); expect(opened).toEqual(["document-999"]);
    await key("9", { ctrlKey: true }); expect(opened).toEqual(["document-999", "document-8"]);
    await search("candidate 999");
    expect(document.querySelector('[cmdk-input]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(document.querySelectorAll('[cmdk-item]')).toHaveLength(1);
    expect(selected()?.textContent).toContain("Candidate 999");
    await search("");
    expect(document.querySelectorAll('[cmdk-group-heading]').length).toBeGreaterThan(1);
  } finally {
    await act(async () => root.unmount()); mount.remove();
    useUIStore.getState().closeCommandPalette();
  }
});
