import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "DocumentFragment", "HTMLFormElement", "HTMLSelectElement", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const controls = await import("../apps/desktop/src/preview-controls/viewer-selection-controls");
const viewer = readFileSync("PreviewExtension/Web/viewer.js", "utf8");
const source = (name: string) => {
  const start = viewer.indexOf(`  function ${name}(`);
  if (start < 0) throw new Error(`Missing viewer function: ${name}`);
  return viewer.slice(start, viewer.indexOf("\n  }", start) + 4);
};

test("selection builders preserve exact queries, modifiers, actions, placement and teardown", async () => {
  const queries = [
    { label: "All", category: "Common" },
    { label: "Hidden query", isHidden: true },
    { label: "Protein", category: "Type" },
    { label: "Alanine (ALA)", category: "Amino Acid" },
  ];
  const writes: unknown[] = [];
  const selection = { stats: { elementCount: 0 }, fromSelectionQuery: (...args: unknown[]) => writes.push(args) };
  const plugin = { query: { structure: { registry: { list: queries } } }, managers: { structure: {
    selection, hierarchy: { current: { structures: [{}] } },
    component: { constructor: { getRepresentationTypes: () => [["ball-and-stick", "Ball & Stick"], ["spacefill", "Spacefill"]] } },
  } }, state: { data: { canUndo: false } } };
  const undo: unknown[] = [], redo: unknown[] = [];
  const bindings = {
    document, window: { innerWidth: 800, innerHeight: 600, BuretteNativeViewerMenus: {
      stylePopover: () => {}, mountQueryControls: controls.mountViewerQueryControls, mountSelectionActions: controls.mountViewerSelectionActions,
    } }, viewportPlugin: () => plugin, activeConfig: {}, resolveViewerTheme: () => "dark",
    hideGenerate3DMenu: () => {}, hideMolstarPresetMenu: () => {},
    SELECTION_MODIFIERS: [["set", "Replace"], ["add", "Add"], ["remove", "Remove"], ["intersect", "Keep"]],
    SCENE_TREE_UNIFORM_COLORS: [{ label: "Red", value: 0xff0000 }, { label: "Blue", value: 0x0000ff }],
    sceneTreeColorHex: (value: number) => `#${value.toString(16).padStart(6, "0")}`,
    molstarEditUndoStack: undo, molstarEditRedoStack: redo,
    paintViewportSelection: (value: number) => writes.push(["paint", value]),
    addViewportSelectionComponent: (value: string) => writes.push(["add", value]),
    runViewportMenuAction: (value: string) => { writes.push(["action", value]); return false; },
  };
  const methods = ["openViewportMenu", "closeViewportMenu", "positionOpenViewportMenu", "viewportQueryMenu", "viewportApplyMenu"].map(source).join("\n");
  const eventStart = viewer.indexOf("      // The menu is portalled to <body>");
  const events = viewer.slice(eventStart, viewer.indexOf("\n    }\n    for (const disposer", eventStart));
  const api = new Function(...Object.keys(bindings), `let viewportMenuControls = null; let selectionQueryModifier = 'set'; ${methods}; ${events}; return {
    query: button => openViewportMenu(button, 'Select', viewportQueryMenu),
    apply: button => openViewportMenu(button, 'Apply', viewportApplyMenu),
    close: closeViewportMenu, refresh: () => viewportMenuControls?.refresh?.(), position: positionOpenViewportMenu
  };`)(...Object.values(bindings));
  const bar = document.createElement("div"); bar.id = "buret-selection-bar";
  bar.innerHTML = '<button aria-expanded="false">Select</button><button aria-expanded="false">Apply</button>';
  document.body.append(bar);
  const [select, apply] = bar.querySelectorAll("button");
  select.getBoundingClientRect = () => new DOMRect(250, 70, 60, 30);
  const menu = () => document.getElementById("buret-viewport-menu")!;
  const button = (label: string) => [...menu().querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
  const search = async (value: string) => act(async () => {
    const input = menu().querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => api.query(select));
    expect(menu().getAttribute("role")).toBe("dialog");
    expect(document.activeElement).toBe(menu().querySelector("input"));
    expect(menu().textContent).not.toContain("Hidden query");
    menu().getBoundingClientRect = () => new DOMRect(0, 0, 324, 400);
    api.position();
    expect([menu().style.left, menu().style.top]).toEqual(["250px", "104px"]);
    await act(async () => button("Add").click());
    await search("zzzz");
    expect(menu().querySelector("[cmdk-empty]")?.textContent).toBe("No matching selections");
    await search("Protein");
    await act(async () => menu().querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(writes).toEqual([["add", queries[2], false]]);
    expect(document.getElementById("buret-viewport-menu")).toBeNull();
    expect(document.activeElement).toBe(select);
    await act(async () => api.query(select));
    expect(button("Add").getAttribute("aria-checked")).toBe("true");
    await act(async () => button("Keep").click());
    await search("Alanine");
    await act(async () => menu().querySelector<HTMLElement>('[cmdk-item][data-selected="true"]')!.click());
    expect(writes.at(-1)).toEqual(["intersect", queries[3], false]);

    await act(async () => api.apply(apply));
    expect([...menu().querySelectorAll<HTMLButtonElement>("button")].every(node => node.disabled)).toBe(true);
    selection.stats.elementCount = 4; undo.push({}); redo.push({});
    await act(async () => api.refresh());
    expect([...menu().querySelectorAll<HTMLButtonElement>("button")].every(node => !node.disabled)).toBe(true);
    await act(async () => menu().querySelector<HTMLButtonElement>('[aria-label="Use Blue"]')!.click());
    expect(writes.at(-1)).toEqual(["paint", 255]);
    expect(menu().querySelector('[aria-label="Use Blue"]')?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => menu().querySelector<HTMLElement>('[role="combobox"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const options = [...menu().querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.map(node => node.textContent)).toEqual(["Ball & Stick", "Spacefill"]);
    // Opening Radix Select can retarget the pointer's trailing click to body.
    await act(async () => document.body.click());
    expect(document.getElementById("buret-viewport-menu")).not.toBeNull();
    await act(async () => options[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(menu().querySelector('[role="listbox"][data-state="open"]')).toBeNull();
    expect(document.getElementById("buret-viewport-menu")).not.toBeNull();
    await act(async () => menu().querySelector<HTMLElement>('[role="combobox"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const spacefill = [...menu().querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === "Spacefill")!;
    const commitKey = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => spacefill.dispatchEvent(commitKey));
    expect(commitKey.defaultPrevented).toBe(true);
    expect(writes.at(-1)).toEqual(["add", "spacefill"]);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(apply);
    for (const [label, action] of [["Reset colour", "selection-color-reset"], ["Cut out of components", "selection-subtract"], ["Undo", "undo"], ["Redo", "redo"], ["Clear selection", "selection-clear"]]) {
      await act(async () => api.apply(apply));
      await act(async () => button(label).click());
      expect(writes.at(-1)).toEqual(["action", action]);
      expect(document.getElementById("buret-viewport-menu")).toBeNull();
    }
    await act(async () => api.refresh());
    expect(document.getElementById("buret-viewport-menu")).toBeNull();
    await act(async () => api.query(select));
    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(document.getElementById("buret-viewport-menu")).toBeNull();
  } finally { await act(async () => api.close()); bar.remove(); }
});
