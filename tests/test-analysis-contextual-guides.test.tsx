import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import type { ContextualGuideRequest } from "../apps/desktop/src/components/onboarding/request";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
import type { ChemicalSpaceResult } from "../apps/desktop/src/lib/compute-cluster";
import type { ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window({ url: "http://localhost/" });
for (const key of ["CSS", "window", "document", "navigator", "DocumentFragment", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLIFrameElement", "HTMLCanvasElement", "DOMParser", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MessageEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Heavy runtimes stay out of the DOM test: RDKit wasm, Plotly, viewer iframes
// and the browser-dev embedding are replaced by instant stand-ins.
const drawn: string[] = [];
mock.module("plotly.js-basic-dist-min", () => ({
  default: {
    newPlot: async () => {}, purge: () => {}, Plots: { resize: () => {} },
    react: async (element: HTMLElement) => { drawn.push(element.className); },
  },
}));
mock.module("../apps/desktop/src/lib/rdkit-module", () => ({ loadRDKitModule: () => new Promise(() => {}) }));
const viewerFrame = await import("../apps/desktop/src/components/editor-area/viewer-frame");
mock.module("../apps/desktop/src/components/editor-area/viewer-frame", () => ({ ...viewerFrame, ViewerFrame: () => null }));
const embedding: ChemicalSpaceResult = {
  sourceRecordIds: [0, 1], positions: [[0, 0, 0], [1, 1, 0]], treeEdges: [[0, 1]], neighborEdges: [], neighborSimilarities: [],
  dimensions: 2, method: "umap", representation: "morgan", neighbors: 1, successfulRecords: 2, failedRecords: 0,
  backend: "nativeMetal", tanimotoGpuTimeMs: 0, embeddingGpuTimeMs: 0, layoutHostTimeMs: 0, hostTimeMs: 0,
};
const compute = await import("../apps/desktop/src/lib/browser-dev-compute");
mock.module("../apps/desktop/src/lib/browser-dev-compute", () => ({ ...compute, runBrowserDevChemicalSpace: async () => embedding }));

const { createRoot } = await import("react-dom/client");
const { fepNetworkKind } = await import("../apps/desktop/src/components/editor-area/page-kinds/fep-network");
const { SpectrumViewer } = await import("../apps/desktop/src/components/spectrum-viewer");
const { ChemicalSpacePanel } = await import("../apps/desktop/src/components/chemical-space-panel");
const { contextualGuideRequestEvent, registerContextualGuideHost } = await import("../apps/desktop/src/components/onboarding/request");
const { releaseContextualGuide, saveOnboardingProgress } = await import("../apps/desktop/src/components/onboarding/progress");
const { writeBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");

let requests: ContextualGuideRequest[] = [];
let mount: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let unregister: () => void;
const collect = (event: Event) => requests.push((event as CustomEvent<ContextualGuideRequest>).detail);
const fresh = () => saveOnboardingProgress({ enabled: true, welcomeCompleted: true, seen: [] });

async function waitFor<T>(read: () => T | null | undefined | false, message: string): Promise<T> {
  const deadline = Date.now() + 4000;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${message}: ${mount.innerHTML.slice(0, 600)}`);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
}

beforeEach(() => {
  localStorage.clear();
  fresh();
  requests = [];
  unregister = registerContextualGuideHost();
  window.addEventListener(contextualGuideRequestEvent, collect);
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  window.removeEventListener(contextualGuideRequestEvent, collect);
  unregister();
  for (const id of ["fep-network", "spectra", "chemical-space"] as const) releaseContextualGuide(id);
  localStorage.clear();
});

test("switching Graph, Grid and 3D anchors the FEP guide to the view switch", async () => {
  const graphmlText = readFileSync(new URL("../samples/fep/ligand_network.edge", import.meta.url), "utf8");
  const props = {
    tabId: "fep", isActive: true, actions: {} as ShellActions, location: { kind: "fep-network" as const, graphmlText },
    state: { preferences: defaultPreferences } as ShellViewState,
  };
  await act(async () => root.render(<fepNetworkKind.Component {...props} />));
  const views = await waitFor(() => mount.querySelector<HTMLElement>(`[data-slot="toggle-group"][aria-label="View"]`), "FEP network toolbar");
  expect(requests).toEqual([]);
  const grid = Array.from(views.querySelectorAll("button")).find(button => button.textContent === "Grid")!;
  await act(async () => grid.click());
  expect(requests).toEqual([{ id: "fep-network", anchor: views }]);
});

test("a spectrum asks for its guide once, after the plot is drawn, anchored to its toolbar", async () => {
  const spectrum = { id: "guide-spectrum", title: "spectrum.msp", path: "/education/spectrum.msp", extension: "msp", renderer: "spectrum", virtual: true } as ViewerDocument;
  writeBrowserDevVirtualTextDocument(spectrum.path, readFileSync(new URL("./fixtures/file-kinds/spectrum.msp", import.meta.url), "utf8"));
  try {
    await act(async () => root.render(<SpectrumViewer document={spectrum} />));
    await waitFor(() => requests.length, "spectrum guide request");
    expect(drawn).toEqual(["spectrum-plot"]);
    expect(requests).toEqual([{ id: "spectra", anchor: mount.querySelector("header.spectrum-toolbar") }]);
    // Redraws while the user works with peaks never ask again for this document.
    fresh(); releaseContextualGuide("spectra");
    await act(async () => mount.querySelector<HTMLButtonElement>("#spectrum-normalize")!.click());
    await waitFor(() => drawn.length > 1, "spectrum redraw");
    expect(requests).toHaveLength(1);
  } finally {
    deleteBrowserDevVirtualTextDocument(spectrum.path);
  }
});

test("Chemical space asks for its guide once the map is ready and visible", async () => {
  const collection = { id: "guide-collection", title: "set.smi", path: "/education/set.smi", extension: "smi", renderer: "grid2d", runtimePath: "/grid.html" } as ViewerDocument;
  // The collection's grid frame answers the panel's bridge requests.
  const frame = document.createElement("iframe");
  frame.className = "viewer-iframe";
  frame.dataset.documentId = collection.id;
  frame.dataset.renderer = "grid2d";
  document.body.append(frame);
  const reply = (body: Record<string, unknown>) => window.dispatchEvent(new MessageEvent("message", {
    data: { source: "burette-grid", body: { documentId: collection.id, ...body } }, source: frame.contentWindow,
  }));
  frame.contentWindow!.addEventListener("message", (event) => {
    const { type, requestId } = (event as MessageEvent).data?.body ?? {};
    if (type === "chemicalSpaceRequestIndexState") reply({ type: "chemicalSpaceIndexState", requestId, recordsTotal: 2, recordsIndexed: 2, indexReady: true });
    if (type === "chemicalSpaceRequestRecords") reply({ type: "chemicalSpaceRecords", requestId, records: ["CCO", "c1ccccc1"].map((input, sourceRecordId) => ({ sourceRecordId, moleculeContentSha256: String(sourceRecordId), format: "smiles", input })) });
  });
  try {
    await act(async () => root.render(<ChemicalSpacePanel document={collection} visible={false} />));
    await waitFor(() => mount.querySelector("canvas"), "chemical space map");
    expect(requests).toEqual([]);
    await act(async () => root.render(<ChemicalSpacePanel document={collection} visible />));
    const controls = mount.querySelector('[data-testid="chemical-space-panel"]')!.firstElementChild;
    expect(requests).toEqual([{ id: "chemical-space", anchor: controls }]);
  } finally {
    frame.remove();
  }
});
