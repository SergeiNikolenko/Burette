import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act } from "react";

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} });
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window,
  self: window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  HTMLFormElement: window.HTMLFormElement,
  HTMLSelectElement: window.HTMLSelectElement,
  HTMLButtonElement: window.HTMLButtonElement,
  DocumentFragment: window.DocumentFragment,
  MutationObserver: window.MutationObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  navigator: window.navigator,
  localStorage: window.localStorage,
  requestAnimationFrame: (callback) => window.setTimeout(callback, 0),
  cancelAnimationFrame: (id) => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
previousGlobals.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { test, afterAll } = await import("bun:test");
afterAll(async () => { await window.happyDOM.close(); for (const [name, value] of previousGlobals) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } });
const { createRoot } = await import("react-dom/client");
const { VibrationsPanel } = await import("../apps/desktop/src/components/workbench/vibrations-panel");

const atoms = (shift) => [{ element: "O", x: 0, y: 0, z: 0 }, { element: "H", x: 0.96 + shift, y: 0, z: 0 }, { element: "H", x: -0.24, y: 0.93, z: 0 }];
const doc = { id: "scan", title: "scan.xyz", path: "/scan.xyz", extension: "xyz", renderer: "molstar" };
const key = (target, name) => act(async () => { target.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true })); });

async function mount(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

test("IR peaks are a keyboard control that selects the mode", async () => {
  const displacements = atoms(0).map(() => [0.1, 0, 0]);
  const science = { format: "orca", atoms: atoms(0), frames: [{ atoms: atoms(0) }], orbitals: [], modes: [
    { index: 6, frequencyCm1: 1600, intensityKmMol: 70, displacements },
    { index: 7, frequencyCm1: 3650, intensityKmMol: 5, displacements },
    { index: 8, frequencyCm1: 3750, intensityKmMol: 40, displacements },
  ] };
  const view = await mount(<VibrationsPanel document={doc} science={science} liveAnimation={false} actions={{ runStructureViewerAction: async () => {} }} />);
  try {
    const spectrum = view.host.querySelector('[role="slider"][aria-label="IR peak"]');
    assert.match(spectrum.getAttribute("aria-valuetext"), /^Mode 6, 1600\.0 cm⁻¹/u);
    // Peaks are drawn from high to low wavenumber; Left moves toward higher ones.
    await key(spectrum, "ArrowLeft");
    assert.match(spectrum.getAttribute("aria-valuetext"), /^Mode 7, 3650\.0/u);
    await key(spectrum, "Home");
    assert.match(spectrum.getAttribute("aria-valuetext"), /^Mode 8, 3750\.0/u);
    assert.equal(view.host.querySelector('tr[aria-selected="true"] th').textContent, "8");
  } finally { await view.unmount(); }
});

test("older ORCA output without km/mol draws its transition dipoles in their own unit with the same peak control", async () => {
  const displacements = atoms(0).map(() => [0.1, 0, 0]);
  const science = { format: "orca", atoms: atoms(0), frames: [{ atoms: atoms(0) }], orbitals: [], modes: [
    { index: 6, frequencyCm1: 1600, transitionDipoleSquared: 0.0012, displacements },
    { index: 7, frequencyCm1: 3650, transitionDipoleSquared: 0, displacements },
    { index: 8, frequencyCm1: 3750, transitionDipoleSquared: 0.0004, displacements },
  ] };
  const view = await mount(<VibrationsPanel document={doc} science={science} liveAnimation={false} actions={{ runStructureViewerAction: async () => {} }} />);
  try {
    assert.equal(view.host.querySelector('[aria-label="IR peak"]'), null);
    const spectrum = view.host.querySelector('[role="slider"][aria-label="Transition dipole peak"]');
    assert.equal(spectrum.getAttribute("aria-valuemax"), "2", "a zero transition dipole draws no peak");
    assert.doesNotMatch(view.host.textContent, /km\/mol/u);
    await act(async () => view.host.querySelectorAll(".workbench-peak")[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    assert.equal(spectrum.getAttribute("aria-valuetext"), "Mode 6, 1600.0 cm⁻¹, T² 1.20e-3 a.u.");
    assert.equal(view.host.querySelector('tr[aria-selected="true"] th').textContent, "6");
    await key(spectrum, "Home");
    assert.equal(view.host.querySelector('tr[aria-selected="true"] th').textContent, "8");
  } finally { await view.unmount(); }
});

test("Vibrations shows only the active frame's own modes and keeps the chosen mode per frame", async () => {
  const optimization = { ...doc, id: "orca-frames", title: "orca-frames.xyz", path: "/orca-frames.xyz" };
  const displacements = atoms(0).map(() => [0.1, 0, 0]);
  const science = { format: "orca", atoms: atoms(0), orbitals: [], modes: [], frames: [
    { atoms: atoms(0), modes: [{ index: 6, frequencyCm1: 1000, symmetry: "A'", intensityKmMol: 20, displacements }, { index: 7, frequencyCm1: 1500, symmetry: "A\"", intensityKmMol: 10, displacements }] },
    { atoms: atoms(0.1), modes: [{ index: 6, frequencyCm1: 2000, intensityKmMol: 30, displacements }] },
  ] };
  const panel = <VibrationsPanel document={optimization} science={science} liveAnimation={false} actions={{ runStructureViewerAction: async () => {} }} />;
  const frequencies = (host) => [...host.querySelectorAll('table[aria-label="Vibrational modes"] tbody tr')].map((row) => row.querySelectorAll("td")[0].textContent);
  const selectedMode = (host) => host.querySelector('tr[aria-selected="true"] th')?.textContent;
  const showFrame = (frameIndex, frameCount = 2) => act(async () => {
    window.dispatchEvent(new window.CustomEvent("burette:trajectory-frame-changed", { detail: { documentId: optimization.id, frameIndex, frameCount } }));
  });
  let view = await mount(panel);
  try {
    // The scene opens at the first frame: its modes, with their irreps.
    assert.deepEqual(frequencies(view.host), ["1000.0", "1500.0"]);
    assert.match(view.host.querySelector("thead").textContent, /Symmetry/u);
    await act(async () => view.host.querySelector('tr[data-selectable]:nth-child(2)').click());
    assert.equal(selectedMode(view.host), "7");

    await showFrame(1);
    assert.deepEqual(frequencies(view.host), ["2000.0"], "the second geometry never shows the first one's modes");
    assert.doesNotMatch(view.host.querySelector("thead").textContent, /Symmetry/u, "no symmetry column without irreps");

    await showFrame(0, 5);
    assert.equal(view.host.querySelector("table"), null, "a scene with other frames shows no modes");
    assert.match(view.host.textContent, /No modes for this frame/u);

    await showFrame(0);
    assert.equal(selectedMode(view.host), "7", "returning to a frame restores its chosen mode");
  } finally { await view.unmount(); }
  // Switching tabs or files remounts the panel; the choice survives.
  view = await mount(panel);
  try { assert.equal(selectedMode(view.host), "7"); } finally { await view.unmount(); }
});

test("Raman activity is a second spectrum with its own unit, sharing the mode selection", async () => {
  const displacements = atoms(0).map(() => [0.1, 0, 0]);
  const science = { format: "orca", atoms: atoms(0), frames: [{ atoms: atoms(0) }], orbitals: [], modes: [
    { index: 6, frequencyCm1: 1600, intensityKmMol: 70, ramanActivityAngstrom4Amu: 5.5, ramanDepolarizationRatio: 0.75, displacements },
    { index: 7, frequencyCm1: 3650, intensityKmMol: 5, ramanActivityAngstrom4Amu: 90, ramanDepolarizationRatio: 0.12, displacements },
  ] };
  const view = await mount(<VibrationsPanel document={{ ...doc, id: "raman" }} science={science} liveAnimation={false} actions={{ runStructureViewerAction: async () => {} }} />);
  try {
    const select = view.host.querySelector('select[aria-label="Spectrum"]');
    assert.deepEqual([...select.options].map((option) => option.textContent), ["IR, km/mol", "Raman activity, Å⁴/amu"]);
    assert.match(view.host.querySelector("thead").textContent, /Raman activity, Å⁴\/amu.*Depolarization/u);
    await key(view.host.querySelector('[role="slider"][aria-label="IR peak"]'), "Home");
    assert.equal(view.host.querySelector('tr[aria-selected="true"] th').textContent, "7");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, "raman");
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    const raman = view.host.querySelector('[role="slider"][aria-label="Raman peak"]');
    assert.equal(raman.getAttribute("aria-valuetext"), "Mode 7, 3650.0 cm⁻¹, Raman activity 90.00 Å⁴/amu", "the chosen mode carries over");
    await key(raman, "Home");
    assert.equal(view.host.querySelector('tr[aria-selected="true"] th').textContent, "6");
  } finally { await view.unmount(); }
  // One quantity: no choice to make.
  const single = await mount(<VibrationsPanel document={{ ...doc, id: "raman-only-ir" }} science={{ ...science, modes: science.modes.map(({ ramanActivityAngstrom4Amu, ramanDepolarizationRatio, ...mode }) => mode) }} liveAnimation={false} actions={{ runStructureViewerAction: async () => {} }} />);
  try { assert.equal(single.host.querySelector('select[aria-label="Spectrum"]'), null); } finally { await single.unmount(); }
});

test("displaced exports name and describe the one-based frame they came from", async () => {
  const source = { ...doc, id: "frame-raman", title: "frame-raman.out", path: "/frame-raman.out" };
  const displacements = atoms(0).map(() => [0.1, 0, 0]);
  const science = { format: "orca", atoms: atoms(0.1), orbitals: [], modes: [], frames: [
    { atoms: atoms(0), modes: [{ index: 6, frequencyCm1: 1000, intensityKmMol: 20, displacements }] },
    { atoms: atoms(0.1), modes: [{ index: 6, frequencyCm1: 2000, intensityKmMol: 30, displacements }] },
  ] };
  const opened = [];
  const actions = { runStructureViewerAction: async () => {}, openStructureRecords: async (records) => { opened.push(...records); } };
  const exportDisplaced = async (frameIndex) => {
    await act(async () => { window.dispatchEvent(new window.CustomEvent("burette:trajectory-frame-changed", { detail: { documentId: source.id, frameIndex, frameCount: 2 } })); });
    const trigger = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Open");
    await act(async () => { trigger.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    const item = [...document.body.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent.startsWith("Displaced +"));
    await act(async () => { item.click(); });
    const { path, text } = opened.at(-1);
    const [, comment, , hydrogen] = text.split("\n");
    return { path, comment, hydrogenX: Number(hydrogen.trim().split(/\s+/u)[1]) };
  };
  const view = await mount(<VibrationsPanel document={source} science={science} liveAnimation={false} actions={actions} />);
  try {
    const second = await exportDisplaced(1);
    assert.equal(second.path, "frame-raman-frame-2-mode-6-plus.xyz");
    assert.equal(second.comment, "Frame 2 Mode 6 2000.0 cm-1 displaced +0.30 A");
    const first = await exportDisplaced(0);
    assert.equal(first.path, "frame-raman-frame-1-mode-6-plus.xyz");
    assert.equal(first.comment, "Frame 1 Mode 6 1000.0 cm-1 displaced +0.30 A");
    // The same displacement starts from each frame's own geometry, whose H differs by 0.1 Å along x.
    assert.ok(Math.abs(second.hydrogenX - first.hydrogenX - 0.1) < 1e-6, `${second.hydrogenX} vs ${first.hydrogenX}`);
  } finally { await view.unmount(); }
});
