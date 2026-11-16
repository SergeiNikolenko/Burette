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
  MouseEvent: browser.MouseEvent, MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => {
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  await browser.happyDOM.close();
});
const { createRoot } = await import("react-dom/client");
const { openScientificFiles } = await import("../apps/desktop/src/lib/workbench/open");
const { openBrowserDevTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { CalculationResultsCard } = await import("../apps/desktop/src/components/workbench/calculation-results-card");

type Overlay = { type: string; kind: string; overlay?: { vector?: number[]; label?: string; labels?: string[]; values?: number[] } };

/** Opens a real output as the workbench does and shows its card beside a scene that accepts every action. */
async function open(path: string) {
  const opened: ViewerDocument[] = [];
  const actions: Pick<ShellActions, "openStructureRecords"> = { openStructureRecords: async records => {
    const documents = await Promise.all(records.map(record => openBrowserDevTextDocument(record.path, record.inputExtension, record.text, { ...defaultPreferences, rendererMode: "molstar" })));
    // The import stays with the document only while the workspace lists it.
    opened.push(...documents); useMoleculeStore.setState(state => ({ documents: [...state.documents, ...documents] }));
    return documents;
  } };
  await openScientificFiles(actions, [new File([readFileSync(new URL(`fixtures/quantum/${path}`, import.meta.url), "utf8")], path.split("/").pop()!)]);
  const [viewerDocument] = opened;
  const scene = document.createElement("iframe"); scene.className = "viewer-iframe"; scene.dataset.documentId = viewerDocument.id; scene.dataset.renderer = "molstar";
  const host = document.createElement("div"); document.body.append(scene, host);
  const sent: Overlay[] = [];
  scene.contentWindow!.postMessage = (payload: { body: { id: string; action: Overlay } }) => {
    sent.push(payload.body.action);
    queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { source: scene.contentWindow, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: payload.body.id, result: { ok: true, result: {} } } } })));
  };
  const root = createRoot(host);
  await act(async () => root.render(<CalculationResultsCard document={viewerDocument} />));
  const settle = async (check: () => boolean, what: string) => {
    for (let tries = 0; tries < 200 && !check(); tries++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    if (!check()) throw new Error(`Timed out: ${what}`);
  };
  const toggle = (name: string) => [...host.querySelectorAll("label")].find(label => label.textContent === name)?.querySelector<HTMLElement>('[role="checkbox"]');
  await settle(() => Boolean(toggle("Dipole arrow")), "the charges card");
  return {
    host, sent, settle, toggle,
    frame: async (frameIndex: number, frameCount: number) => { await act(async () => { window.dispatchEvent(new CustomEvent("burette:trajectory-frame-changed", { detail: { documentId: viewerDocument.id, frameIndex, frameCount } })); }); },
    close: async () => { await act(async () => root.unmount()); host.remove(); scene.remove(); deleteBrowserDevVirtualTextDocument(viewerDocument.path);
      useMoleculeStore.setState(state => ({ documents: state.documents.filter(item => item.id !== viewerDocument.id) })); releaseClosedImports(new Set()); },
  };
}

test("overlays follow the frame: a step that printed no charges or dipole clears them, and the next printed one draws its own", async () => {
  // A Gaussian relaxed scan prints its population analysis at the first and the last geometry only.
  const view = await open("reaction-paths/relaxed_PES_testCO2.log");
  try {
    for (const name of ["Color atoms", "Labels", "Dipole arrow"]) await act(async () => view.toggle(name)!.click());
    await view.settle(() => view.sent.length === 3, "the first frame's overlays");
    const shown = (kind: string) => view.sent.filter(action => action.kind === kind).at(-1)!;
    // `Mulliken charges: 1 O -0.401847, 2 C 0.803731, 3 O -0.401885` and `X= 0.0000 Y= -0.0122 Z= -0.0002`.
    expect(shown("charges").overlay!.labels).toEqual(["−0.40", "+0.80", "−0.40"]);
    expect(shown("charge-colors").overlay!.values).toEqual([-0.401847, 0.803731, -0.401885]);
    expect(shown("dipole").overlay).toMatchObject({ vector: [0, -0.0122, -0.0002], label: "0.01 D" });

    view.sent.length = 0;
    await view.frame(1, 36);
    await view.settle(() => view.sent.length === 3, "the second frame's overlays cleared");
    expect(view.sent.map(action => [action.kind, action.overlay]).sort()).toEqual([["charge-colors", undefined], ["charges", undefined], ["dipole", undefined]]);
    expect(view.host.querySelector('[role="alert"]')).toBeNull();

    view.sent.length = 0;
    await view.frame(35, 36);
    await view.settle(() => view.sent.length === 3, "the last frame's overlays");
    // The last geometry: `1 O -0.385438` and `X= 0.0000 Y= -0.4085 Z= -0.2140 Tot= 0.4612`.
    expect(shown("charges").overlay!.labels![0]).toBe("−0.39");
    expect(shown("dipole").overlay).toMatchObject({ vector: [0, -0.4085, -0.214], label: "0.46 D" });
    expect(view.toggle("Dipole arrow")!.getAttribute("aria-checked")).toBe("true");
  } finally { await view.close(); }
});
