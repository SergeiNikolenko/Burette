import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { readFileSync } from "node:fs";

const browser = new Window();
for (const key of ["CSS", "window", "document", "navigator", "DocumentFragment", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";
const { createRoot } = await import("react-dom/client");
const { StructureInfoPanel } = await import("../apps/desktop/src/components/structure-info-panel");
const { writeBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { DEFAULT_CONFORMER_SETTINGS, DEFAULT_XTB_SETTINGS } = await import("../apps/desktop/src/lib/chemistry-settings");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");

const file = readFileSync(new URL("../samples/mini.sdf", import.meta.url), "utf8");
const molecule = { id: "context-controls-test", title: "mini.sdf", path: "/test-context/mini.sdf", extension: "sdf", renderer: "molstar", virtual: true, byteCount: file.length, runtimePath: "/test-viewer.html" } as ViewerDocument;

test("collection style, color and debounced opacity keep exact viewer commands and persisted values", async () => {
  writeBrowserDevVirtualTextDocument(molecule.path, file);
  const calls: unknown[] = [];
  const fileCalls: unknown[] = [];
  const actions = {
    runStructureViewerAction: (document: ViewerDocument, action: unknown) => calls.push([document.id, action]),
    showDocumentMetadata: (document: ViewerDocument) => fileCalls.push(["metadata", document.id]),
    revealDocument: (document: ViewerDocument) => fileCalls.push(["reveal", document.id]),
    copyDocumentPath: (document: ViewerDocument) => fileCalls.push(["copy", document.id]),
  } as unknown as ShellActions;
  const props: React.ComponentProps<typeof StructureInfoPanel> = {
    document: molecule, gridFilterModel: null, dockDrops: [], conformerStatus: null, conformerSettings: DEFAULT_CONFORMER_SETTINGS,
    viewerLigandSelection: null, structureOverlayMode: "all", xtbStatus: null, xtbSettings: DEFAULT_XTB_SETTINGS, xtbJobs: [],
    preferences: defaultPreferences, isBrowserDev: true, actions,
  };
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const button = (name: string) => Array.from(mount.querySelectorAll<HTMLButtonElement>(".structure-inspector-style-options button")).find(el => el.textContent === name)!;
  try {
    await act(async () => root.render(<StructureInfoPanel {...props} />));
    const fileSection = mount.querySelector<HTMLElement>(".structure-inspector-details")!;
    const disclosure = fileSection.querySelector<HTMLElement>("summary")!;
    expect(disclosure.textContent).toBe("File");
    await act(async () => disclosure.click());
    expect(fileSection.textContent).toContain("Molecules2");
    expect(fileSection.textContent).toContain("FormatSDF");
    expect(fileSection.textContent).not.toMatch(/Mol\*|Renderer|Source affordances|Notes|parser|runtime/);
    for (const name of ["Show metadata", "Reveal file", "Copy path"]) {
      const control = Array.from(fileSection.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === name)!;
      await act(async () => control.click());
    }
    expect(fileCalls).toEqual([["metadata", molecule.id], ["reveal", molecule.id], ["copy", molecule.id]]);
    expect(button("Line").getAttribute("data-slot")).toBe("button");
    await act(async () => button("Line").click());
    await act(async () => button("Gray").click());
    expect(calls).toEqual([
      [molecule.id, { type: "set_sdf_context_style", label: "All background: Line", notify: false, style: "line" }],
      [molecule.id, { type: "set_sdf_context_color", label: "All background color: Gray", notify: false, color: "gray" }],
    ]);
    expect(button("Line").getAttribute("aria-pressed")).toBe("true");
    expect(button("Colored").getAttribute("aria-pressed")).toBe("false");
    const slider = mount.querySelector<HTMLElement>('.structure-inspector-opacity-control [role="slider"]')!;
    expect(slider.getAttribute("aria-valuenow")).toBe("0.4");
    await act(async () => slider.focus());
    for (let i = 0; i < 3; i++) await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(calls).toHaveLength(2);
    await act(async () => { await Bun.sleep(180); });
    expect(calls).toHaveLength(3);
    expect(calls.at(-1)).toEqual([molecule.id, { type: "set_sdf_context_opacity", label: "All background opacity: 43%", notify: false, opacity: 0.43 }]);
    expect(localStorage.getItem(`buret.sdf.contextStyle.${molecule.id}`)).toBe("line");
    expect(localStorage.getItem(`buret.sdf.contextColor.${molecule.id}`)).toBe("gray");
    expect(localStorage.getItem(`buret.sdf.contextOpacity.${molecule.id}`)).toBe("0.43");
    // Changing documents cancels pending opacity work and keeps named scene
    // selections mapped to their original zero-based viewer index.
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    const scene = { ...molecule, id: "scene-controls-test", dockingRequest: {
      receptorPath: molecule.path, ligandPaths: ["/poses/second.sdf"], sceneMode: "structurePoses",
    } } as ViewerDocument;
    calls.length = 0;
    await act(async () => root.render(<StructureInfoPanel {...props} document={scene} />));
    const rows = Array.from(mount.querySelectorAll<HTMLButtonElement>(".structure-inspector-pose-row"));
    expect(fileSection.textContent).toContain("Inputs");
    expect(fileSection.textContent).toContain("Structures2");
    expect(fileSection.textContent).toContain("First structuremini.sdf");
    expect(rows.map(row => row.textContent)).toEqual(["1mini.sdf", "2second.sdf"]);
    expect(rows.every(row => row.getAttribute("data-slot") === "button")).toBe(true);
    await act(async () => rows[1].click());
    await act(async () => { await Bun.sleep(180); });
    expect(calls).toEqual([[scene.id, { type: "set_structure_pose", label: "Show structure 2", index: 1 }]]);
    expect(rows.map(row => row.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  } finally {
    await act(async () => root.unmount()); mount.remove(); deleteBrowserDevVirtualTextDocument(molecule.path);
    for (const name of ["Style", "Color", "Opacity"]) localStorage.removeItem(`buret.sdf.context${name}.${molecule.id}`);
  }
});
