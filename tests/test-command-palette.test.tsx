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
