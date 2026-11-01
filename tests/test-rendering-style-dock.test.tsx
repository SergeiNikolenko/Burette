import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "DocumentFragment", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";
const { createRoot } = await import("react-dom/client");
const { DockPanel } = await import("../apps/desktop/src/components/dock-panel");


const molecule = { id: "style-example", title: "Caffeine", path: "/caffeine.xyz", extension: "xyz", renderer: "xyzrender-external", xyzrenderPreset: "default" } as ViewerDocument;
const state = {
  documents: [molecule], textDocuments: [], activeDocument: molecule, visibleDocuments: [molecule],
  activeTab: { location: { kind: "file", path: molecule.path, documentId: molecule.id } },
  rightDockTabs: [{ id: "style", kind: "xyzrender" }], rightDockActiveTab: "xyzrender", rightDockOpen: true,
  rightDockDocumentId: null, rightDockTool: null, dockDroppedStructures: [], hoveredGridRows: {},
} as unknown as ShellViewState;

test("style gallery preserves scientific controls and selection while using shared buttons", async () => {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const calls: unknown[] = [];
  const actions = { openDockTab: () => {}, setStructureDragActive: () => {}, reloadXyzrenderDocument: async (...args: unknown[]) => { calls.push(args); } } as unknown as ShellActions;
  const button = (name: string) => Array.from(mount.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === name)!;
  const click = async (name: string) => { await act(async () => button(name).click()); };
  try {
    await act(async () => root.render(<DockPanel area="right" state={state} actions={actions} />));
    const tiles = Array.from(mount.querySelectorAll(".xyzrender-dock-preset-tile"));
    expect(tiles).toHaveLength(25);
    expect(tiles.every(el => el.getAttribute("data-slot") === "button")).toBe(true);
    expect(button("Default").getAttribute("aria-pressed")).toBe("true");
    await click("All atoms");
    expect(calls.at(-1)).toMatchObject([molecule, { xyzrenderControls: { showVdw: true, vdwAtoms: null } }]);
    await click("Skeletal");
    expect(calls.at(-1)).toMatchObject([molecule, { xyzrenderPreset: "skeletal", xyzrenderControls: { showVdw: false, vdwAtoms: null } }]);
    expect(button("Skeletal").getAttribute("aria-pressed")).toBe("true");
    await click("Partial");
    expect(calls.at(-1)).toMatchObject([molecule, { xyzrenderPreset: "default", xyzrenderSelectionAction: "vdw" }]);
    expect(button("Partial").getAttribute("aria-pressed")).toBe("false");
    await click("Essential H");
    expect(calls.at(-1)).toMatchObject([molecule, { xyzrenderControls: { displayHydrogens: "none" } }]);
    await click("Faces + pore");
    expect(calls.at(-1)).toMatchObject([molecule, { xyzrenderControls: { hullMode: "faces-pore", hullOpacity: 0.45, poreOpacity: 0.6 } }]);
    await click("Reset");
    expect(calls.at(-1)).toMatchObject([molecule, { xyzrenderPreset: "default", xyzrenderControls: { hullMode: "off", displayHydrogens: "auto", showVdw: false } }]);
    expect(button("Default").getAttribute("aria-pressed")).toBe("true");
    expect(button("Faces + pore").getAttribute("aria-pressed")).toBe("false");
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
