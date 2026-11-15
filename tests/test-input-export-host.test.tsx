import { afterAll, expect, test } from "bun:test";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import type { ViewerDocument } from "../apps/desktop/src/types";
plugin({ name: "input-export-compiler", setup(build) {
  build.onLoad({ filter: /(?:input-export-(?:dialog|host)\.tsx|use-workbench-source\.ts)$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "tsx",
  }));
} });
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { TextFileSaveOutcome } from "../apps/desktop/src/lib/file-export";

const previous = new Map<string, PropertyDescriptor | undefined>();
const window = new Window({ url: "http://localhost/" });
for (const [name, value] of Object.entries({
  window, self: window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement, HTMLFormElement: window.HTMLFormElement, HTMLSelectElement: window.HTMLSelectElement,
  SVGElement: window.SVGElement, DocumentFragment: window.DocumentFragment, MutationObserver: window.MutationObserver,
  CustomEvent: window.CustomEvent, Event: window.Event, FocusEvent: window.FocusEvent, KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent, PointerEvent: window.PointerEvent, navigator: window.navigator, localStorage: window.localStorage,
  NodeFilter: window.NodeFilter, getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value, writable: true }); }
previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });
afterAll(async () => { await new Promise(resolve => setTimeout(resolve, 10)); await window.happyDOM.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } });

const { writeBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } = await import('../apps/desktop/src/lib/browser-dev-documents');
const { createRoot } = await import('react-dom/client');
const { InputExportDialogHost } = await import('../apps/desktop/src/components/workbench/input-export-host');
const { openWorkbenchDialog, closeWorkbenchDialog } = await import('../apps/desktop/src/lib/workbench/dialog-store');
const { adoptLogicalSource, releaseClosedScienceSessions } = await import('../apps/desktop/src/lib/science-session/state');
const water = [{ element: 'O', x: 0, y: 0, z: 0 }, { element: 'H', x: .96, y: 0, z: 0 }, { element: 'H', x: -.24, y: .93, z: 0 }];
const xyz = '3\nwater\nO 0 0 0\nH .96 0 0\nH -.24 .93 0\n';
let serial = 0;
const doc = () => ({ id: `input-${++serial}`, path: `/input-${serial}.molx`, title: 'water.xyz', extension: 'molx', renderer: 'molstar' }) as ViewerDocument;
async function until(predicate: () => unknown) { for (let i = 0; i < 100 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(Boolean(predicate())).toBe(true); }
const text = () => document.querySelector('textarea')?.value ?? '';
const click = async (label: string) => act(async () => { [...document.querySelectorAll('button')].find(node => node.textContent === label)!.click(); });
async function mount() {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const saved: { title: string; extension: string; text: string }[] = [];
  const actions = { saveKetcherExportFile: async (request: (typeof saved)[number]) => { saved.push(request); return { status: 'saved', path: null }; } } as ShellActions;
  await act(async () => root.render(<InputExportDialogHost actions={actions} />));
  return { saved, close: async () => { await act(async () => root.unmount()); host.remove(); closeWorkbenchDialog(); releaseClosedScienceSessions(new Set()); } };
}
test('compiled typed consumer reads logical source and exports every original program with constraints', async () => {
  const f = await mount(), d = doc();
  try {
    adoptLogicalSource({ documentId: d.id, extension: 'xyz', text: xyz }, 'input-test', null, []);
    await act(async () => openWorkbenchDialog({ kind: 'input', document: d, constraints: [{ kind: 'freeze', atoms: [0] }] }));
    await until(() => text().includes('* xyz 0 1')); expect(text()).toContain('{ C 0 C }'); await click('Save');
    await click('Gaussian'); expect(text()).toContain('Opt=ModRedundant'); expect(text()).toContain('X 1 F'); await click('Save');
    await click('Psi4'); expect(text()).toContain('frozen_cartesian = "1 xyz"'); await click('Save');
    await click('CP2K'); expect(text()).toContain('RUN_TYPE GEO_OPT'); expect(text()).toContain('LIST 1'); await click('Save');
    expect(f.saved.map(file => file.extension)).toEqual(['inp', 'gjf', 'dat', 'inp']);
    expect(f.saved.every(file => file.title.startsWith('water.') && file.text.length > 50)).toBe(true);
    await act(async () => closeWorkbenchDialog()); expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally { await f.close(); }
});
test('a new request for the same document resets program state and uses its edited atoms, not prior form', async () => {
  const f = await mount(), d = doc();
  try {
    adoptLogicalSource({ documentId: d.id, extension: 'xyz', text: xyz }, 'input-test', null, []);
    await act(async () => openWorkbenchDialog({ kind: 'input', document: d, atoms: water })); await until(() => text().includes('B3LYP'));
    await click('CP2K'); expect(text()).toContain('&GLOBAL');
    const moved = water.map(atom => ({ ...atom, x: atom.x + 2 }));
    await act(async () => openWorkbenchDialog({ kind: 'input', document: { ...d }, atoms: moved }));
    expect(text()).toContain('! B3LYP def2-SVP SP'); expect(text()).toContain('O 2.00000000 0.00000000 0.00000000');
    await act(async () => openWorkbenchDialog({ kind: 'properties', document: d })); expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally { await f.close(); }
});
test('CP2K retains the source periodic cell and can deliberately switch to an isolated padded box', async () => {
  const f = await mount(), d = doc();
  const cif = 'data_water\n_cell_length_a 10\n_cell_length_b 11\n_cell_length_c 12\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n_space_group_name_H-M_alt \'P 1\'\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nO1 O 0 0 0\nH1 H .096 0 0\nH2 H -.024 .0845454545 0\n';
  try {
    d.path = `burette-ketcher://${d.id}/water.cif`; d.extension = 'cif'; d.title = 'water.cif';
    writeBrowserDevVirtualTextDocument(d.path, cif);
    await act(async () => openWorkbenchDialog({ kind: 'input', document: d })); await until(() => text().includes('B3LYP')); await click('CP2K');
    expect(text()).toContain('PERIODIC XYZ'); expect(text()).toContain('B 0.00000000 11.00000000 0.00000000');
    const toggle = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('Periodic cell from file'))!.querySelector('button')!;
    await act(async () => toggle.click()); expect(text()).toContain('PERIODIC NONE'); expect(text()).toContain('POISSON_SOLVER WAVELET');
  } finally { await f.close(); deleteBrowserDevVirtualTextDocument(d.path); }
});

test('independent: a delayed copy cannot label another program result as copied', async () => {
 const f = await mount(), d = doc(); const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
 let complete!: () => void; const copied: string[] = [];
 Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (value: string) => { copied.push(value); return new Promise<void>(resolve => { complete = resolve; }); } } });
 try {
  adoptLogicalSource({ documentId: d.id, extension: 'xyz', text: xyz }, 'copy-race', null, []);
  await act(async () => openWorkbenchDialog({ kind: 'input', document: d })); await until(() => text().includes('B3LYP'));
  const original = text(); await click('Copy'); await click('Gaussian');
  expect(text()).toContain('#p B3LYP/6-31G(d) SP'); expect(copied).toEqual([original]);
  await act(async () => complete());
  expect([...document.querySelectorAll('button')].some(button => button.textContent === 'Copied')).toBe(false);
 } finally { await f.close(); if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor); else Reflect.deleteProperty(navigator, 'clipboard'); }
});
test('independent: edited atoms cannot save an isolated CP2K box while the real periodic source cell is loading', async () => {
 const OriginalWorker = globalThis.Worker; const queue: (() => void)[] = [];
 class HeldWorker extends OriginalWorker {
  override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) { queue.push(() => { if (Array.isArray(options)) super.postMessage(message, options); else super.postMessage(message, options); }); }
 }
 Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: HeldWorker });
 const f = await mount(), d = doc();
 const cif = 'data_water\n_cell_length_a 10\n_cell_length_b 11\n_cell_length_c 12\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n_space_group_name_H-M_alt \'P 1\'\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nO1 O 0 0 0\nH1 H .096 0 0\nH2 H -.024 .0845454545 0\n';
 try {
  d.path = `burette-ketcher://${d.id}/slow-cell.cif`; d.extension = 'cif'; d.title = 'slow-cell.cif';
  writeBrowserDevVirtualTextDocument(d.path, cif);
  await act(async () => openWorkbenchDialog({ kind: 'input', document: d, atoms: water }));
  await until(() => queue.length > 0); await click('CP2K'); await click('Save');
  const earlyFiles = [...f.saved];
  await act(async () => { for (const submit of queue.splice(0)) submit(); });
  await until(() => text().includes('PERIODIC XYZ'));
  expect(text()).toContain('B 0.00000000 11.00000000 0.00000000');
  expect(earlyFiles).toEqual([]);
 } finally { await f.close(); deleteBrowserDevVirtualTextDocument(d.path); Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: OriginalWorker }); }
});

test('independent: failed periodic source reading cannot silently become an isolated CP2K export', async () => {
 const f = await mount(), d = doc();
  const cif = 'data_water\n_cell_length_a 10\n_cell_length_b 11\n_cell_length_c 12\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n_space_group_name_H-M_alt \'P 1\'\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nO1 O 0 0 0\nH1 H .096 0 0\nH2 H -.024 .0845454545 0\n';
 try {
  d.path = `burette-ketcher://${d.id}/invalid-cell.cif`; d.extension = 'cif'; d.title = 'invalid-cell.cif';
  writeBrowserDevVirtualTextDocument(d.path, cif.replace('_cell_length_a 10', '_cell_length_a invalid'));
  await act(async () => openWorkbenchDialog({ kind: 'input', document: d, atoms: water }));
  await until(() => document.querySelector('[role="alert"]')?.textContent);
  await click('CP2K'); await click('Save');
  expect(f.saved).toEqual([]);
  const toggle = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('Periodic cell from file'))!.querySelector('button')!;
  await act(async () => toggle.click()); await click('Save');
  expect(f.saved.map(file => file.text.includes('PERIODIC NONE'))).toEqual([true]);
 } finally { await f.close(); deleteBrowserDevVirtualTextDocument(d.path); }
});

test('independent: invalid declared XYZ lattice is not silently exported as an isolated CP2K model', async () => {
 const f = await mount(), d = doc();
 try {
  const periodic = xyz.replace('water', 'Lattice="10 0 0 0 0 0 0 0 12"');
  adoptLogicalSource({ documentId: d.id, extension: 'xyz', text: periodic }, 'bad-lattice', null, []);
  await act(async () => openWorkbenchDialog({ kind: 'input', document: d }));
  await until(() => text().includes('B3LYP')); await click('CP2K'); await click('Save');
  expect(f.saved).toEqual([]);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('source cell is invalid');
  const toggle = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('Periodic cell from file'))!.querySelector('button')!;
  await act(async () => toggle.click()); await click('Save');
  expect(f.saved.map(file => file.text.includes('PERIODIC NONE'))).toEqual([true]);
 } finally { await f.close(); }
});
