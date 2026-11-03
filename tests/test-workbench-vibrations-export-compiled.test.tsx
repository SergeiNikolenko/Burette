import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act } from "react";

// The app build runs apps/desktop/src through the React Compiler (vite.config.ts); compile the
// Vibrations panel the same way so its export and spectrum state follow the shipped memoization.
plugin({
  name: "react-compiler",
  setup(build) {
    build.onLoad({ filter: /apps\/desktop\/src\/components\/workbench\/(?:vibrations-panel|vibrational-spectrum|vibrational-plot)\.tsx$/ }, ({ path }) => {
      const compiled = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
        parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [["babel-plugin-react-compiler", {}]] });
      console.log(JSON.stringify({ module: path.split("/").at(-1), compilerCacheEmitted: compiled.code.includes("react/compiler-runtime") }));
      if (path.endsWith("/vibrations-panel.tsx")) assert.match(compiled.code, /react\/compiler-runtime/u, `${path} was compiled`);
      return { contents: compiled.code, loader: "tsx" };
    });
  },
});

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} });
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window, self: window, document: window.document, CSS: window.CSS, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement, HTMLFormElement: window.HTMLFormElement, HTMLSelectElement: window.HTMLSelectElement, HTMLButtonElement: window.HTMLButtonElement,
  DocumentFragment: window.DocumentFragment, MutationObserver: window.MutationObserver, CustomEvent: window.CustomEvent, Event: window.Event,
  KeyboardEvent: window.KeyboardEvent, MouseEvent: window.MouseEvent, PointerEvent: window.PointerEvent, navigator: window.navigator,
  localStorage: window.localStorage, requestAnimationFrame: (callback) => window.setTimeout(callback, 0), cancelAnimationFrame: (id) => window.clearTimeout(id),
  getComputedStyle: window.getComputedStyle.bind(window), ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
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
const { hessianFromLowerTriangle } = await import("../apps/desktop/src/lib/molecular-workbench/hessian");

const atoms = (shift) => [{ element: "O", x: 0, y: 0, z: 0 }, { element: "H", x: 0.96 + shift, y: 0, z: 0 }, { element: "H", x: -0.24, y: 0.93, z: 0 }];
const displacements = atoms(0).map(() => [0.1, 0, 0]);
const triangle = Array.from({ length: 45 }, (_, index) => (index % 10 === 0 ? 0.5 : 0.01 * (index % 7)));
const hessian = hessianFromLowerTriangle(triangle, 3, [15.9949146, 1.00782504, 1.00782504]);
// Two geometries of one ORCA run, each with its own modes; only the second carries a Hessian.
// Mode 0 is a rigid-body row: never listed, always saved.
const science = { format: "orca", atoms: atoms(0.1), orbitals: [], modes: [], frames: [
  { atoms: atoms(0), modes: [{ index: 0, frequencyCm1: 0 }, { index: 6, frequencyCm1: 1600, intensityKmMol: 70, displacements }] },
  { atoms: atoms(0.1), hessian, modes: [{ index: 0, frequencyCm1: 0 }, { index: 6, frequencyCm1: 1590, symmetry: "A'", intensityKmMol: 65, ramanActivityAngstrom4Amu: 3.5, displacements },
    { index: 7, frequencyCm1: 3650, intensityKmMol: 12, displacements }] },
] };
const source = { id: "orca-scan", title: "scan.out", path: "/scan.out", extension: "xyz", renderer: "molstar" };

async function mount(element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const showFrame = (frameIndex) => act(async () => {
  window.dispatchEvent(new window.CustomEvent("burette:trajectory-frame-changed", { detail: { documentId: source.id, frameIndex, frameCount: 2 } }));
});
const choose = (select, value) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, value);
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
});

test("Export saves the shown frame's whole spectrum and Hessian, and the line shape draws a curve that survives frame changes", async () => {
  const saved = [];
  const actions = { runStructureViewerAction: async () => {}, saveKetcherExportFile: async (request) => { saved.push(request); return { status: "saved", path: null }; } };
  const view = await mount(<VibrationsPanel document={source} science={science} liveAnimation={false} actions={actions} />);
  const exportItems = async () => {
    const trigger = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Export");
    await act(async () => { trigger.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    return [...document.body.querySelectorAll('[role="menuitem"]')];
  };
  const exportAs = async (label) => {
    const item = (await exportItems()).find((node) => node.textContent === label);
    await act(async () => { item.click(); });
    return saved.at(-1);
  };
  try {
    await showFrame(1);
    assert.deepEqual((await exportItems()).map((node) => node.textContent), ["Spectrum as CSV", "Spectrum as JSON", "Modes as JSON", "Hessian as JSON"]);
    await act(async () => { document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    const csv = await exportAs("Spectrum as CSV");
    assert.equal(csv.title, "scan-frame-2-spectrum.csv");
    assert.equal(csv.extension, "csv");
    const lines = csv.text.trim().split("\n");
    assert.deepEqual(lines.slice(0, 3), ["# source: scan.out", "# format: orca", "# geometry: frame 2 of 2"]);
    assert.deepEqual(lines.slice(5), ["0,0,,,,,,,,", "6,1590,A',65,,3.5,,,,", "7,3650,,12,,,,,,"]);
    const saveHessian = await exportAs("Hessian as JSON");
    assert.equal(saveHessian.title, "scan-frame-2-hessian.json");
    const matrix = JSON.parse(saveHessian.text);
    assert.deepEqual({ units: matrix.units, frame: matrix.source.frame, rows: matrix.matrix.flat() }, { units: "hartree/bohr^2", frame: 2, rows: Array.from(hessian.values) });

    // The other geometry: its own modes, and no Hessian to save.
    await showFrame(0);
    assert.deepEqual((await exportItems()).map((node) => node.textContent), ["Spectrum as CSV", "Spectrum as JSON", "Modes as JSON"]);
    await act(async () => { document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    const json = JSON.parse((await exportAs("Spectrum as JSON")).text);
    assert.deepEqual(json.source, { name: "scan.out", format: "orca", frame: 1, frameCount: 2 });
    const modes = await exportAs("Modes as JSON"), table = JSON.parse(modes.text);
    assert.equal(modes.title, "scan-frame-1-modes.json");
    assert.deepEqual({ frame: table.source.frame, atoms: table.atoms.map((atom) => atom.xAngstrom), modes: table.modes.map((mode) => [mode.mode, mode.frequencyCm1, mode.displacements]) },
      { frame: 1, atoms: atoms(0).map((atom) => atom.x), modes: [[6, 1600, displacements]] });
    assert.deepEqual(json.modes.map((mode) => [mode.mode, mode.frequencyCm1, mode.irIntensityKmMol, mode.ramanActivityAngstrom4Amu]), [[0, 0, null, null], [6, 1600, 70, null]]);

    // The preserved supplemental mode retains sticks and unit-area broadening.
    await choose(view.host.querySelector('select[aria-label="Spectrum display"]'), "area");
    const figure = () => view.host.querySelector('[role="slider"][aria-label="IR peak"]');
    assert.equal(figure().querySelector("path"), null);
    await choose(view.host.querySelector('select[aria-label="Line shape"]'), "gaussian");
    assert.ok(view.host.querySelector('[aria-label="FWHM, cm⁻¹"]') && view.host.querySelector('[aria-label="Frequency scale"]'));
    assert.match(figure().querySelector("path").getAttribute("d"), /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+){399}$/u);
    assert.deepEqual([...figure().querySelectorAll("figcaption span")].map((node) => node.textContent), ["km/mol per cm⁻¹", "Wavenumber, cm⁻¹"]);
    await showFrame(1);
    assert.equal(view.host.querySelector('select[aria-label="Line shape"]').value, "gaussian", "the line shape is kept for the next geometry");
    assert.ok(figure().querySelector("path"));
    await choose(view.host.querySelector('select[aria-label="Line shape"]'), "sticks");
    assert.equal(figure().querySelector("path"), null);
    assert.equal(view.host.querySelector('[aria-label="FWHM, cm⁻¹"]'), null);
  } finally { await view.unmount(); }
});

test("A finite but enormous FCHK frequency is kept as read and drawn on a bounded axis", async () => {
  const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
  const fchk = readFileSync(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url), "utf8");
  const edited = fchk.replace("2.16987538E+03", "1.50000000E+308");
  assert.notEqual(edited, fchk);
  const huge = parseScientificFile("huge.fchk", edited);
  assert.equal(huge.modes[0].frequencyCm1, 1.5e308);
  // Record every Array.from length while the panel renders: none may scale with the frequency.
  const lengths = [];
  const arrayFrom = Array.from;
  Array.from = function (items, ...rest) { if (typeof items?.length === "number") lengths.push(items.length); return arrayFrom.call(this, items, ...rest); };
  const view = await mount(<VibrationsPanel document={{ ...source, id: "huge-frequency" }} science={huge} liveAnimation={false} actions={{ runStructureViewerAction: async () => {} }} />);
  const figure = () => view.host.querySelector('[role="slider"]');
  const ticks = () => [...figure().querySelectorAll(".workbench-tick")];
  try {
    assert.ok([...view.host.querySelectorAll("td")].some((cell) => cell.textContent === "1.5e+308"), "the table lists the frequency as read");
    assert.deepEqual(ticks().map((tick) => tick.textContent), ["0", "2e+307", "4e+307", "6e+307", "8e+307", "1e+308", "1.2e+308", "1.4e+308"]);
    assert.ok(ticks().every((tick) => Number.isFinite(Number(tick.getAttribute("x")))));
    assert.equal(figure().querySelectorAll(".workbench-peak").length, huge.modes.filter((mode) => mode.frequencyCm1 > 0 && mode.intensityKmMol > 0).length);

    await choose(view.host.querySelector('select[aria-label="Line shape"]'), "gaussian");
    assert.match(figure().querySelector("path").getAttribute("d"), /^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+){399}$/u);
    assert.equal(ticks().length, 8);

    // Scaled by 1.5, 1.5e308 runs past the largest double: with no finite axis the chart says so instead of drawing.
    const scaleField = view.host.querySelector('button[aria-label="Frequency scale"]');
    await act(async () => { scaleField.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true })); });
    assert.equal(view.host.querySelector('[role="alert"]')?.textContent, "A frequency is too large to draw on the wavenumber axis.");
    assert.equal(figure(), null);
    assert.ok([...view.host.querySelectorAll("td")].some((cell) => cell.textContent === "1.5e+308"), "the table still lists the mode");
    await choose(view.host.querySelector('select[aria-label="Line shape"]'), "sticks");
    assert.equal(ticks().length, 8);
    assert.ok(Math.max(...lengths) <= 400, `largest array ${Math.max(...lengths)}`);
  } finally { Array.from = arrayFrom; await view.unmount(); }
});


test("global modes retain reference geometry; only its explicit frame supplies the Hessian", async () => {
  const own = { ...hessian, values:Float64Array.from(hessian.values,()=>0) }, other = {...hessian,values:Float64Array.from(hessian.values,()=>0)};
  for(let i=0;i<9;i++) { own.values[i*9+i]=1; other.values[i*9+i]=2; }
  for(const referenceFrameIndex of [0,undefined]) {
    const saved=[];
    const doc={...science,atoms:atoms(0),referenceFrameIndex,modes:[{index:6,frequencyCm1:1600,intensityKmMol:70,displacements}],
      frames:[{atoms:atoms(0),hessian:own},{atoms:atoms(.1),hessian:other}]};
    const actions={runStructureViewerAction:async()=>({lease:"reference-main",text:"3\nmain\nO 0 0 0\nH .96 0 0\nH -.24 .93 0\n"}),saveKetcherExportFile:async(request)=>{saved.push(request);return {status:"saved",path:null};}};
    const view=await mount(<VibrationsPanel document={{...source,id:`reference-${referenceFrameIndex}`}} science={doc} liveAnimation={true} actions={actions}/>);
    try {
      assert.ok([...view.host.querySelectorAll("td")].some(cell=>cell.textContent==="1600.0"));
      assert.ok([...view.host.querySelectorAll("button")].some(button=>button.textContent==="Animate"));
      const trigger=[...view.host.querySelectorAll("button")].find(button=>button.textContent==="Export");
      await act(async()=>trigger.dispatchEvent(new window.KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
      const items=[...document.body.querySelectorAll('[role="menuitem"]')];
      assert.deepEqual(items.map(item=>item.textContent),referenceFrameIndex===0?["Spectrum as CSV","Spectrum as JSON","Modes as JSON","Hessian as JSON"]:["Spectrum as CSV","Spectrum as JSON","Modes as JSON"]);
      if(referenceFrameIndex===0) {
        await act(async()=>items.find(item=>item.textContent==="Hessian as JSON").click());
        const result=JSON.parse(saved.at(-1).text);
        assert.deepEqual(result.matrix.flat(),Array.from(own.values));
        assert.deepEqual(result.atoms,[{element:"O",xAngstrom:0,yAngstrom:0,zAngstrom:0},{element:"H",xAngstrom:.96,yAngstrom:0,zAngstrom:0},{element:"H",xAngstrom:-.24,yAngstrom:.93,zAngstrom:0}]);
      } else await act(async()=>document.body.dispatchEvent(new window.KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
    } finally { await view.unmount(); }
  }
});

test("a geometry with a Hessian and masses but no modes computes them on request", async () => {
  const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
  const { harmonicModes } = await import("../apps/desktop/src/lib/molecular-workbench/normal-modes");
  const science = parseScientificFile("water-hf-hessian.json", readFileSync(new URL("./fixtures/quantum/qcschema/water-hf-hessian.json", import.meta.url), "utf8"));
  const saved = [];
  const actions = { runStructureViewerAction: async () => {}, saveKetcherExportFile: async (request) => { saved.push(request); return { status: "saved", path: null }; } };
  const view = await mount(<VibrationsPanel document={{ ...source, id: "hessian-only", title: "water-hf-hessian.json" }} science={science} liveAnimation={false} actions={actions} />);
  try {
    assert.equal(view.host.querySelector("table"), null);
    const compute = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Compute modes");
    await act(async () => { compute.click(); });
    for (let wait = 0; wait < 200 && !view.host.querySelector("table"); wait++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const expected = harmonicModes(science.atoms, science.frames[0].hessian);
    assert.deepEqual([...view.host.querySelectorAll("tbody td:first-of-type")].map((cell) => cell.textContent), expected.map((mode) => mode.frequencyCm1.toFixed(1)));
    const trigger = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Export");
    await act(async () => { trigger.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await act(async () => { [...document.body.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent === "Modes as JSON").click(); });
    const table = JSON.parse(saved.at(-1).text);
    assert.equal(saved.at(-1).title, "water-hf-hessian-modes.json");
    assert.deepEqual(table.modes.map((mode) => [mode.frequencyCm1, mode.reducedMassAmu, mode.displacements]), expected.map((mode) => [mode.frequencyCm1, mode.reducedMassAmu, mode.displacements]));
  } finally { await view.unmount(); }
});
