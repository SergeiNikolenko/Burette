import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLSelectElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { mountViewerSelectionToolbar } = await import("../apps/desktop/src/preview-controls/viewer-selection-toolbar");
const viewer = readFileSync("PreviewExtension/Web/viewer.js", "utf8");
const source = (name: string) => {
  const start = viewer.indexOf(`  function ${name}(`);
  if (start < 0) throw new Error(`Missing viewer function: ${name}`);
  return viewer.slice(start, viewer.indexOf("\n  }", start) + 4);
};

test("selection toolbar follows live scene state and retains one action binding across viewer reinitialization", async () => {
  document.body.innerHTML = '<div id="buret-viewport-rail"><button data-buret-viewport-action="select-mode"></button><button data-buret-viewport-action="clear-selection"></button></div><div id="buret-selection-bar" class="hidden"></div>';
  const bar = document.getElementById("buret-selection-bar")!;
  let level = "residue";
  const calls: unknown[] = [];
  const listeners = new Set<() => void>();
  const changed = { subscribe(callback: () => void) { listeners.add(callback); return { unsubscribe: () => listeners.delete(callback) }; } };
  const plugin = { selectionMode: true, managers: { structure: { selection: {
    stats: { elementCount: 0, label: "" }, events: { changed },
  } } } };
  const bindings = {
    document, window: { BuretteNativeViewerMenus: { mountSelectionToolbar: mountViewerSelectionToolbar, styleControls: () => {} } },
    viewportPlugin: () => plugin, activeConfig: {}, resolveViewerTheme: () => "dark",
    molstarSelectionLevel: () => level, setMolstarSelectionLevel: (value: string) => { level = value; calls.push(["level", value]); },
    VIEWPORT_GRANULARITIES: [["none", "None"], ["atom", "Atom"], ["residue", "Residue"], ["chain", "Chain"]],
    initViewportRailDrag: () => {}, updateViewportAnimateState: () => {}, updateFloatingLayoutOffsets: () => {},
    runViewportRailAction: () => {}, runViewportMenuAction: () => false,
    viewportQueryMenu: () => {}, viewportApplyMenu: () => {},
    openViewportMenu: (button: HTMLButtonElement, name: string) => { button.setAttribute("aria-expanded", "true"); calls.push(["open", name]); },
  };
  const methods = ["initViewportControls", "updateSelectionBar", "runSelectionBarAction", "closeViewportMenu"].map(source).join("\n");
  const api = new Function(...Object.keys(bindings), `let viewportControlsDisposers = []; let viewportSelectionControls = null; let viewportMenuControls = null;
    ${methods}; return { init: initViewportControls, update: updateSelectionBar, dispose: () => {
      viewportSelectionControls?.dispose(); viewportControlsDisposers.forEach(dispose => dispose());
    } };`)(...Object.values(bindings));
  const action = (name: string) => bar.querySelector<HTMLButtonElement>(`[data-buret-selection-action="${name}"]`)!;
  try {
    await act(async () => api.init({ plugin }));
    const select = bar.querySelector("select")!;
    expect([...select.options].map(option => [option.value, option.text])).toEqual(bindings.VIEWPORT_GRANULARITIES);
    expect([select.value, bar.classList.contains("hidden"), bar.querySelector('[aria-live="polite"]')?.textContent]).toEqual(["residue", false, "Nothing selected"]);
    await act(async () => { select.value = "atom"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(calls).toEqual([["level", "atom"]]);
    level = "chain";
    plugin.managers.structure.selection.stats = { elementCount: 8, label: "2 Residues" };
    await act(async () => listeners.forEach(listener => listener()));
    expect([select.value, bar.querySelector('[aria-live="polite"]')?.textContent]).toEqual(["chain", "2 Residues"]);
    // Reloading a scene rebinds subscriptions, not the React root or action listeners.
    await act(async () => api.init({ plugin }));
    expect(bar.querySelector("select")).toBe(select);
    expect(listeners.size).toBe(1);
    await act(async () => action("query").click());
    await act(async () => api.update());
    expect(action("query").getAttribute("aria-expanded")).toBe("true");
    await act(async () => action("apply").click());
    expect(calls).toEqual([["level", "atom"], ["open", "Select"], ["open", "Apply"]]);
    await act(async () => bar.querySelector<HTMLButtonElement>('[aria-label="Leave selection mode"]')!.click());
    expect([plugin.selectionMode, bar.classList.contains("hidden"), action("apply").getAttribute("aria-expanded")]).toEqual([false, true, "false"]);
    plugin.selectionMode = true;
    await act(async () => api.update());
    expect([bar.classList.contains("hidden"), select.value]).toEqual([false, "chain"]);
  } finally { await act(async () => api.dispose()); document.body.innerHTML = ""; }
  expect(listeners.size).toBe(0);
});
