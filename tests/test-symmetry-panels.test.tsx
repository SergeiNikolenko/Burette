import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import React, { act } from "react";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { fixtureText, reference } from "./crystal-reference";

// The Crystal and Symmetry panels on the real browser source-editing controller:
// every edit is one Undo step of the document's own draft, read back independently.
const browser = new Window({ url: "http://localhost/" });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({ window: browser, self: browser, document: browser.document, Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement, HTMLSelectElement: browser.HTMLSelectElement, HTMLFormElement: browser.HTMLFormElement, HTMLButtonElement: browser.HTMLButtonElement, HTMLIFrameElement: browser.HTMLIFrameElement,
  SVGElement: browser.SVGElement, DocumentFragment: browser.DocumentFragment, MutationObserver: browser.MutationObserver, NodeFilter: browser.NodeFilter, CustomEvent: browser.CustomEvent,
  Event: browser.Event, FocusEvent: browser.FocusEvent, KeyboardEvent: browser.KeyboardEvent, MouseEvent: browser.MouseEvent, PointerEvent: browser.PointerEvent, indexedDB: new IDBFactory(),
  navigator: browser.navigator, localStorage: browser.localStorage, getComputedStyle: browser.getComputedStyle.bind(browser), ResizeObserver: browser.ResizeObserver,
  requestAnimationFrame: (fn: () => void) => browser.setTimeout(fn, 0), cancelAnimationFrame: (id: ReturnType<typeof browser.setTimeout>) => browser.clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const { createRoot } = await import("react-dom/client");
const { openBrowserDevDocuments, readBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { registerDroppedBrowserFiles } = await import("../apps/desktop/src/lib/web-demo-workspace");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { CrystalPanel } = await import("../apps/desktop/src/components/workbench/crystal-panel");
const { SymmetryPanel } = await import("../apps/desktop/src/components/workbench/symmetry-panel");
const { readCrystalDocument } = await import("../apps/desktop/src/lib/molecular-workbench/crystal-io");

const wait = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 400 && !check(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  expect(check(), label).toBe(true);
};
const buttons = () => [...browser.document.querySelectorAll("button")] as unknown as HTMLButtonElement[];
const button = (label: string) => buttons().find(node => node.textContent === label || node.getAttribute("aria-label") === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
const text = () => browser.document.body.textContent ?? "";

async function mount(name: string, options: { text?: string; panel?: typeof CrystalPanel; ready?: string } = {}) {
  const Panel = options.panel ?? CrystalPanel;
  const imported = await registerDroppedBrowserFiles([new File([options.text ?? fixtureText(name)], name.split("/").at(-1)!)], 20_000_000);
  expect(imported.errors).toEqual([]);
  const { documents: [source] } = await openBrowserDevDocuments(imported.paths, defaultPreferences);
  useMoleculeStore.setState({ documents: [source], tabs: [], activeTabId: null });
  const errors: unknown[] = [], opened: ViewerDocument[] = [];
  let editing!: ReturnType<typeof useSourceEditingController>;
  const noop = () => {};
  function App() {
    const files = useAppFileOpen({ preferences: defaultPreferences, addProjectRoot: noop, addBackgroundDocuments: noop, addBackgroundTextDocuments: noop,
      addDocuments: (docs, options) => { opened.push(...docs); useMoleculeStore.getState().addDocuments(docs, options); }, addTextDocuments: noop, closeDocument: noop,
      detectContentSpectrumPaths: async () => new Set<string>(), expandStructureBundles: async paths => paths, openDockTab: noop, openDocumentsInActiveTab: noop,
      openDocumentTab: noop, openFepNetworkTab: noop, openTextDocumentsInActiveTab: noop, pushErrorStatus: noop, pushStatus: noop,
      rememberRecentStructures: noop, replaceDocument: noop, setActiveDocument: noop, setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop, setDocuments: noop });
    editing = useSourceEditingController({ activeDocument: source, preferences: defaultPreferences, pushErrorStatus: error => errors.push(error), setDockOpen: noop, setDockActiveTab: noop });
    return <SourceEditingProvider value={editing}><Panel document={source} actions={{ openStructureRecords: files.openStructureRecords, runStructureViewerAction: async () => ({ ok: true }) } as unknown as ShellActions} /></SourceEditingProvider>;
  }
  const host = browser.document.createElement("div"); browser.document.body.append(host); const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<App />));
  await wait(() => Boolean(button(options.ready ?? "Build supercell")), "panel read");
  return {
    source, errors, opened, get editing() { return editing; },
    draft: () => editing.sessionForDocument(source)?.content ?? null,
    close: async () => { await act(async () => root.unmount()); host.remove(); useMoleculeStore.setState({ documents: [], tabs: [], activeTabId: null }); },
  };
}

test("urea CIF: space group, a 2×2×2 supercell as one Undo step, Undo and Redo through the source draft", async () => {
  const panel = await mount("urea.cif");
  try {
    const original = fixtureText("urea.cif");
    const urea = reference.fixtures["urea.cif"];
    await wait(() => text().includes(`(${urea.spglib["0.01"].number})`), "space group");
    expect(button("Undo").disabled).toBe(true);
    await click("Build supercell");
    await wait(() => panel.draft() !== null && panel.draft() !== original && !button("Build supercell").disabled, "supercell written");
    const supercell = await readCrystalDocument({ format: "cif", text: panel.draft()! });
    expect(supercell.atoms).toHaveLength(urea.atomCount * 8);
    expect(Math.abs(supercell.cell[0][0] * supercell.cell[1][1] * supercell.cell[2][2])).toBeCloseTo(urea.volume * 8, 6);
    expect(panel.errors).toEqual([]);
    await wait(() => !button("Undo supercell").disabled, "undo enabled");
    await click("Undo supercell");
    await wait(() => panel.draft() === original, "undo restores the source text");
    await click("Redo supercell");
    await wait(() => (panel.draft()?.length ?? 0) > original.length, "redo returns the supercell");
    expect((await readCrystalDocument({ format: "cif", text: panel.draft()! })).atoms).toHaveLength(urea.atomCount * 8);
    // An edit made elsewhere starts a new history: nothing to undo into.
    await act(async () => panel.editing.updateDraft(panel.source, original, { view: "keep" }));
    await wait(() => button("Undo").disabled && button("Redo").disabled, "history restarted");
  } finally { await panel.close(); }
});

test("triclinic extended XYZ: the asymmetric unit opens as a new CIF, the source stays untouched", async () => {
  const panel = await mount("triclinic-molecule.xyz");
  try {
    await wait(() => !button("Asymmetric unit").disabled, "symmetry analysed");
    await click("Asymmetric unit");
    await wait(() => panel.opened.length === 1, "asymmetric unit opened");
    const cif = readBrowserDevVirtualTextDocument(panel.opened[0].path)!;
    expect(cif).toContain("_space_group_symop_operation_xyz");
    const reread = await readCrystalDocument({ format: "cif", text: cif });
    expect(reread.atoms).toHaveLength(reference.fixtures["triclinic-molecule.xyz"].atomCount);
    expect(panel.draft()).toBeNull();
    expect(button("Undo").disabled).toBe(true);
  } finally { await panel.close(); }
});

test("CONTCAR: standard orientation stays a POSCAR draft with its selective dynamics and pymatgen's vectors", async () => {
  const panel = await mount("CONTCAR");
  try {
    expect(panel.source.extension).toBe("vasp");
    await click("Standard orientation");
    await wait(() => panel.draft() !== null && !button("Standard orientation").disabled, "orientation written");
    const { readPoscar } = await import("../apps/desktop/src/lib/molecular-workbench/poscar");
    const before = readPoscar(fixtureText("CONTCAR")), after = readPoscar(panel.draft()!);
    expect(after.selectiveDynamics).toEqual(before.selectiveDynamics);
    expect(after.atoms.map(atom => atom.element)).toEqual(before.atoms.map(atom => atom.element));
    after.cell.flat().forEach((value, index) => expect(value).toBeCloseTo(reference.fixtures.CONTCAR.standardOrientation.flat()[index], 6));
    expect(button("Undo standard orientation").disabled).toBe(false);
  } finally { await panel.close(); }
});

/** Every atom of a pymatgen reference molecule moved by up to 0.02 Å. */
function distorted(file: string) {
  const lines = fixtureText(file).trimEnd().split("\n");
  return lines.map((line, index) => {
    if (index < 2) return line;
    const [element, ...xyz] = line.trim().split(/\s+/u);
    return [element, ...xyz.map((value, axis) => (Number(value) + 0.02 * Math.sin(index * 3 + axis)).toFixed(6))].join(" ");
  }).join("\n") + "\n";
}

test("distorted XYZ ammonia: C3v at the loose tolerance, Symmetrize as one Undo step that pymatgen's group survives at the tight one", async () => {
  const { analyzePointGroup } = await import("../apps/desktop/src/lib/molecular-workbench/symmetry/point-group");
  const { instantiateStandaloneWasm } = await import("../apps/desktop/src/lib/molecular-workbench/symmetry/wasm-module");
  const { parseXyz } = await import("../apps/desktop/src/lib/molecular-workbench/xyz");
  const msym = await instantiateStandaloneWasm(new URL("../apps/desktop/src/lib/molecular-workbench/symmetry/burette-msym.wasm", import.meta.url));
  const source = distorted(reference.molecules.ammonia.file);
  expect(analyzePointGroup(msym, { atoms: parseXyz(source).atoms, tolerance: "tight" }, "detect").pointGroup).not.toBe("C3v");
  const panel = await mount("ammonia.xyz", { text: source, panel: SymmetryPanel, ready: "Undo" });
  try {
    await act(async () => buttons().find(node => node.textContent === "Loose")!.click());
    await wait(() => Boolean(button("Symmetrize")) && text().includes("Point group"), "point group found");
    expect(browser.document.querySelector('[aria-label="C3v"]')).not.toBeNull();
    await click("Symmetrize");
    await wait(() => panel.draft() !== null && panel.draft() !== source, "symmetrized draft");
    const symmetrized = parseXyz(panel.draft()!);
    expect(symmetrized.atoms.map(atom => atom.element)).toEqual(parseXyz(source).atoms.map(atom => atom.element));
    expect(analyzePointGroup(msym, { atoms: symmetrized.atoms, tolerance: "tight" }, "detect").pointGroup).toBe(reference.molecules.ammonia.schoenflies);
    expect(panel.draft()!.split("\n")[1]).toBe(source.split("\n")[1]);
    await wait(() => !button("Undo").disabled, "undo enabled");
    await click("Undo");
    await wait(() => panel.draft() === source, "undo restores the distorted source");
  } finally { await panel.close(); }
});

test("distorted MOL water: Symmetrize is one step of the shared graph draft and reaches C2v exactly", async () => {
  const { analyzePointGroup } = await import("../apps/desktop/src/lib/molecular-workbench/symmetry/point-group");
  const { instantiateStandaloneWasm } = await import("../apps/desktop/src/lib/molecular-workbench/symmetry/wasm-module");
  const { parseXyz } = await import("../apps/desktop/src/lib/molecular-workbench/xyz");
  const msym = await instantiateStandaloneWasm(new URL("../apps/desktop/src/lib/molecular-workbench/symmetry/burette-msym.wasm", import.meta.url));
  const atoms = parseXyz(distorted(reference.molecules.water.file)).atoms;
  const row = (atom: (typeof atoms)[number]) => `${atom.x.toFixed(4).padStart(10)}${atom.y.toFixed(4).padStart(10)}${atom.z.toFixed(4).padStart(10)} ${atom.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`;
  const mol = ["water", "  Burette", "", "  3  2  0  0  0  0  0  0  0  0999 V2000", ...atoms.map(row), "  1  2  1  0", "  1  3  1  0", "M  END", ""].join("\n");
  const panel = await mount("water.mol", { text: mol, panel: SymmetryPanel, ready: "Undo" });
  try {
    await act(async () => buttons().find(node => node.textContent === "Loose")!.click());
    await wait(() => Boolean(button("Symmetrize")) && Boolean(browser.document.querySelector('[aria-label="C2v"]')), "point group found");
    await click("Symmetrize");
    await wait(() => panel.draft() !== null && panel.draft() !== mol && Boolean(button("Symmetrize")), "symmetrized draft");
    // The graph draft is the V3000 connection table the Edit panel writes.
    const moved = [...panel.draft()!.matchAll(/^M {2}V30 \d+ ([A-Z][a-z]?) (\S+) (\S+) (\S+)/gmu)].map(([, element, x, y, z]) => ({ element, x: Number(x), y: Number(y), z: Number(z) }));
    expect(moved.map(atom => atom.element)).toEqual(["O", "H", "H"]);
    expect(analyzePointGroup(msym, { atoms: moved, tolerance: "tight" }, "detect").pointGroup).toBe(reference.molecules.water.schoenflies);
    await wait(() => !button("Undo").disabled, "undo enabled");
    await click("Undo");
    await wait(() => panel.draft() === mol, "undo restores the source");
  } finally { await panel.close(); }
});

afterAll(async () => {
  await act(async () => new Promise(resolve => setTimeout(resolve, 30)));
  await browser.happyDOM.close();
  for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
});
