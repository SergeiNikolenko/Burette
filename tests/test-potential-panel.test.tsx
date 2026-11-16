import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window({ url: "http://localhost/" });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement,
  Element: browser.Element, Node: browser.Node, CSS: browser.CSS, Event: browser.Event, CustomEvent: browser.CustomEvent, MessageEvent: browser.MessageEvent,
  MouseEvent: browser.MouseEvent, KeyboardEvent: browser.KeyboardEvent, MutationObserver: browser.MutationObserver, ResizeObserver: browser.ResizeObserver,
  HTMLFormElement: browser.HTMLFormElement, HTMLInputElement: browser.HTMLInputElement, HTMLSelectElement: browser.HTMLSelectElement, HTMLButtonElement: browser.HTMLButtonElement,
  SVGElement: browser.SVGElement, DocumentFragment: browser.DocumentFragment, getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => {
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  await browser.happyDOM.close();
});
const { createRoot } = await import("react-dom/client");
const { openScientificFiles } = await import("../apps/desktop/src/lib/workbench/open");
const { openBrowserDevTextDocument, deleteBrowserDevVirtualTextDocument, readBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { releaseClosedImports, scientificStateFor } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
const { PotentialPanel } = await import("../apps/desktop/src/components/workbench/potential-panel");

type Sent = { type: string; cube?: string; coloring?: { min: number; max: number } };

/** Opens a real output as the workbench does and shows its Potential panel beside a scene that records every action. */
async function open(path: string) {
  const opened: ViewerDocument[] = [];
  const openActions: Pick<ShellActions, "openStructureRecords"> = { openStructureRecords: async records => {
    const documents = await Promise.all(records.map(record => openBrowserDevTextDocument(record.path, record.inputExtension, record.text, { ...defaultPreferences, rendererMode: "molstar" })));
    opened.push(...documents); useMoleculeStore.setState(state => ({ documents: [...state.documents, ...documents] }));
    return documents;
  } };
  await openScientificFiles(openActions, [new File([readFileSync(new URL(`fixtures/quantum/${path}`, import.meta.url), "utf8")], path.split("/").pop()!)]);
  const [viewerDocument] = opened, text = readBrowserDevVirtualTextDocument(viewerDocument.path)!;
  const science = scientificStateFor(viewerDocument.id, text).revision!.document;
  const scene = document.createElement("iframe"); scene.className = "viewer-iframe"; scene.dataset.documentId = viewerDocument.id; scene.dataset.renderer = "molstar";
  const host = document.createElement("div"); document.body.append(scene, host);
  const sent: Sent[] = [];
  let held: (() => void) | null = null, holdNext = false;
  const actions = { runStructureViewerAction: (_document: ViewerDocument, action: Sent) => {
    sent.push(action);
    if (action.type === "scalar_field_binding") return Promise.resolve({ lease: "lease-1" });
    if (action.type === "show_scalar_field" && action.cube && holdNext) { holdNext = false; return new Promise<void>(resolve => { held = resolve; }); }
    return Promise.resolve({});
  } } as unknown as ShellActions;
  const root = createRoot(host);
  await act(async () => root.render(<PotentialPanel document={viewerDocument} actions={actions} science={science} sourceText={text} sourceKind="xyz" structure={null} />));
  const settle = async (check: () => boolean, what: string) => {
    for (let tries = 0; tries < 400 && !check(); tries++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    if (!check()) throw new Error(`Timed out: ${what}`);
  };
  const button = (name: string) => [...host.querySelectorAll("button")].find(item => item.textContent === name);
  return {
    host, sent, settle, button,
    surfaces: () => sent.filter(action => action.type === "show_scalar_field"),
    click: async (name: string) => { await act(async () => button(name)!.click()); },
    hold: () => { holdNext = true; }, isHeld: () => Boolean(held), release: async () => { await act(async () => { held?.(); held = null; }); },
    frame: async (frameIndex: number, frameCount: number) => { await act(async () => { window.dispatchEvent(new CustomEvent("burette:trajectory-frame-changed", { detail: { documentId: viewerDocument.id, frameIndex, frameCount } })); }); },
    close: async () => { await act(async () => root.unmount()); host.remove(); scene.remove(); deleteBrowserDevVirtualTextDocument(viewerDocument.path);
      useMoleculeStore.setState(state => ({ documents: state.documents.filter(item => item.id !== viewerDocument.id) })); releaseClosedImports(new Set()); },
  };
}

test("the surface follows the frame: a step without charges clears it, and the next step with charges draws its own", async () => {
  // A Gaussian relaxed scan prints Mulliken charges at the first and the last geometry only.
  const view = await open("reaction-paths/relaxed_PES_testCO2.log");
  try {
    await view.click("Show surface");
    await view.settle(() => view.surfaces().length === 1, "the first frame's surface");
    const first = view.surfaces()[0];
    // A surface field and the potential colouring it, on the first geometry (C at the origin, O at ±1.1 Å).
    const pair = parseScientificFile("first.cube", first.cube!);
    expect(pair.gridDatasets).toHaveLength(2);
    expect(pair.atoms.map(atom => [atom.element, Number(atom.z.toFixed(4))])).toEqual([["O", -1.1], ["C", 0], ["O", 1.1]]);
    expect(first.coloring!.min).toBe(-first.coloring!.max);

    await view.frame(1, 36);
    await view.settle(() => view.surfaces().length === 2, "the surface cleared on a frame without charges");
    expect(view.surfaces()[1].cube).toBe("");

    await view.frame(35, 36);
    await view.settle(() => view.surfaces().length === 3, "the last frame's surface");
    const last = parseScientificFile("last.cube", view.surfaces()[2].cube!);
    expect(last.gridDatasets).toHaveLength(2);
    expect(view.surfaces()[2].cube).not.toBe(first.cube);
    expect(view.host.querySelector('[role="alert"]')).toBeNull();
  } finally { await view.close(); }
});

test("Cancel while the scene is drawing the surface leaves no surface behind", async () => {
  const view = await open("reaction-paths/relaxed_PES_testCO2.log");
  try {
    view.hold();
    await view.click("Show surface");
    await view.settle(view.isHeld, "the scene drawing the surface");
    await view.click("Cancel");
    await view.release();
    await view.settle(() => Boolean(view.button("Show surface")), "the panel offering the surface again");
    // The surface that was being drawn is cleared, and showing it again draws it again.
    expect(view.surfaces().map(action => Boolean(action.cube))).toEqual([true, false]);
    await view.click("Show surface");
    await view.settle(() => view.surfaces().length === 3, "the surface drawn again");
    expect(Boolean(view.surfaces()[2].cube)).toBe(true);
  } finally { await view.close(); }
});
