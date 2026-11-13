import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act } from "react";

const window = new Window({ url: "http://localhost/" });
window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} });
for (const [name, value] of Object.entries({
  window,
  CSS: window.CSS,
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
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { test, afterAll } = await import("bun:test");
const { fixture, closeRuntime } = await import("./fixtures/retained-trajectory-native.mjs");
const { multiFrameXyz } = await import("../apps/desktop/src/lib/workbench/formats");
afterAll(closeRuntime);
let activeNative;
const pending = new Set();
async function settle() { await act(async () => { while (pending.size) await Promise.all([...pending]); }); }
async function sceneFrame(frameIndex, frameCount) {
  await act(async () => { await activeNative.plugin.state.data.build().to(activeNative.model()).update({modelIndex:frameIndex}).commit();
    window.dispatchEvent(new window.CustomEvent("burette:trajectory-frame-changed", { detail: { documentId: doc.id, frameIndex, frameCount } })); });
  await settle();
}
const { createRoot } = await import("react-dom/client");
const { PlotsPanel } = await import("../apps/desktop/src/components/workbench/plots-panel");

const atoms = (shift) => [{ element: "O", x: 0, y: 0, z: 0 }, { element: "H", x: 0.96 + shift, y: 0, z: 0 }, { element: "H", x: -0.24, y: 0.93, z: 0 }];
const doc = { id: "scan", title: "scan.xyz", path: "/scan.xyz", extension: "xyz", renderer: "molstar" };
const key = async (target, name) => { await act(async () => { target.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true })); }); await settle(); };

async function mount(element) {
  const sourceText = element.props.sourceText ?? multiFrameXyz(element.props.science.frames.map(frame => ({atoms:frame.atoms,comment:"owned-plot-source"})));
  const native = await fixture(sourceText); activeNative = native;
  const iframe = document.createElement("iframe"); iframe.className="viewer-iframe"; iframe.dataset.documentId=doc.id; document.body.append(iframe);
  iframe.contentWindow.postMessage = message => {
    if (message.body.type === "agent-action-cancel") return;
    const action=message.body.action;
    const job=(async()=>{
      let result;
      try { if(action.type === "set_structure_pose") await element.props.actions.runStructureViewerAction(doc,action); result=await native.execute(action); }
      catch(error){result={ok:false,error:{message:error.message}};}
      window.dispatchEvent(new window.MessageEvent("message",{source:iframe.contentWindow,data:{source:"burette-agent-viewer",body:{type:"agent-action-result",id:message.body.id,result}}}));
      if(action.type === "set_structure_pose" && result.ok)window.dispatchEvent(new window.CustomEvent("burette:trajectory-frame-changed",{detail:{documentId:doc.id,frameIndex:native.index(),frameCount:element.props.science.frames.length}}));
    })(); pending.add(job);void job.finally(()=>pending.delete(job));
  };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(React.cloneElement(element,{sourceText}))); await settle();
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove();iframe.remove();native.close(); } };
}

test("the energy plot follows the scene frame and seeks it from the keyboard", async () => {
  const science = { format: "xyz", atoms: atoms(0), frames: [0, 0.01, 0.02, 0.03].map((shift, index) => ({ atoms: atoms(shift), energyHartree: -76 + index * 0.001 })), modes: [], orbitals: [] };
  const sent = [];
  const view = await mount(<PlotsPanel document={doc} science={science} actions={{ runStructureViewerAction: async (_document, action) => { sent.push(action); } }} />);
  try {
    // Without a scene playing these frames there is nothing to seek.
    assert.equal(view.host.querySelector('[role="slider"]'), null);
    await sceneFrame(1, 4);
    const slider = view.host.querySelector('[role="slider"][aria-label^="ΔE"]');
    assert.equal(slider.getAttribute("aria-valuenow"), "2");
    assert.equal(slider.getAttribute("aria-valuetext"), "Frame 2, ΔE 0.63 kcal/mol");
    await key(slider, "ArrowRight");
    await key(slider, "End");
    await key(slider, "Home");
    assert.deepEqual(sent.map((action) => [action.type, action.index]), [["set_structure_pose", 2], ["set_structure_pose", 3], ["set_structure_pose", 0]]);
  } finally { await view.unmount(); }
});

test("time, temperature and force series appear only when every frame or some frame carries them", async () => {
  const frames = [0, 0.01, 0.02].map((shift, index) => ({ atoms: atoms(shift), timePs: index * 0.5, temperatureKelvin: 300 + index,
    forcesKcalMolAngstrom: atoms(0).map(() => [index + 1, 0, 0]) }));
  const view = await mount(<PlotsPanel document={doc} science={{ format: "xyz", atoms: atoms(0), frames, modes: [], orbitals: [] }} actions={{ runStructureViewerAction: async () => {} }} />);
  try {
    await sceneFrame(2, 3);
    assert.ok(view.host.querySelector('[aria-label="Horizontal axis"]'));
    assert.match(view.host.textContent, /1\.000 ps/u);
    assert.equal(view.host.querySelector('[role="slider"][aria-label="Temperature, K frame"]').getAttribute("aria-valuetext"), "Frame 3, Temperature 302.0 K");
    assert.equal(view.host.querySelector('[role="slider"][aria-label="Max force, kcal/(mol·Å) frame"]').getAttribute("aria-valuetext"), "Frame 3, Max force 3.00 kcal/(mol·Å)");
    // No energies in these frames: no energy chart and no unit choice.
    assert.equal(view.host.querySelector('[aria-label="Energy unit"]'), null);
  } finally { await view.unmount(); }
  const plain = await mount(<PlotsPanel document={doc} science={{ format: "xyz", atoms: atoms(0), frames: frames.map(({ atoms }) => ({ atoms })), modes: [], orbitals: [] }} actions={{ runStructureViewerAction: async () => {} }} />);
  try {
    assert.equal(plain.host.querySelector('[aria-label="Horizontal axis"]'), null);
    assert.equal(plain.host.querySelector('[aria-label^="Temperature"]'), null);
  } finally { await plain.unmount(); }
});

test("every series line paints with a colour its chart defines and labels each axis tick distinctly", async () => {
  // Max forces of 0.4 … 1.9 step the axis by 0.5, which whole-number labels used to collapse into 0, 1, 1, 2, 2.
  const forces = [0.4, 0.9, 1.4, 1.9];
  const frames = forces.map((force, index) => ({ atoms: atoms(index * 0.01), energyHartree: -76 + index * 0.001, temperatureKelvin: 300 + index * 1e5,
    forcesKcalMolAngstrom: atoms(0).map(() => [force, 0, 0]) }));
  // Give the charts a real box so Recharts draws its SVG.
  const proto = window.HTMLElement.prototype;
  const box = Object.getOwnPropertyDescriptor(proto, "getBoundingClientRect") ?? { value: proto.getBoundingClientRect, configurable: true, writable: true };
  Object.defineProperty(proto, "getBoundingClientRect", { configurable: true, writable: true, value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 144, width: 320, height: 144 }) });
  for (const [name, value] of [["clientWidth", 320], ["clientHeight", 144], ["offsetWidth", 320], ["offsetHeight", 144]]) Object.defineProperty(proto, name, { configurable: true, get: () => value });
  const view = await mount(<PlotsPanel document={doc} science={{ format: "xyz", atoms: atoms(0), frames, modes: [], orbitals: [] }} actions={{ runStructureViewerAction: async () => {} }} />);
  try {
    await sceneFrame(1, 4);
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 20)); });
    const charts = [...view.host.querySelectorAll('[data-slot="chart"]')];
    assert.equal(charts.length, 3, "energy, temperature and max force");
    for (const chart of charts) {
      const defined = new Set([...chart.querySelector("style").textContent.matchAll(/(--color-[\w-]+):/gu)].map((match) => match[1]));
      const curve = chart.querySelector("path.recharts-curve");
      assert.ok(curve, "the series line is drawn");
      assert.equal(curve.getAttribute("stroke"), "var(--color-value)");
      const painted = [...chart.querySelectorAll(".recharts-line [stroke], .recharts-reference-dot [fill]")]
        .flatMap((node) => [node.getAttribute("stroke"), node.getAttribute("fill")])
        .flatMap((paint) => [...(paint ?? "").matchAll(/var\((--color-[\w-]+)\)/gu)].map((match) => match[1]));
      assert.ok(painted.includes("--color-value"));
      for (const token of painted) assert.ok(defined.has(token), `${token} is defined by the chart`);
    }
    const ticks = (chart) => [...chart.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value")].map((node) => node.textContent);
    const [, temperature, force] = charts.map(ticks);
    assert.deepEqual(force, ["0.0", "0.5", "1.0", "1.5", "2.0"]);
    for (const labels of charts.map(ticks)) assert.equal(new Set(labels).size, labels.length, labels.join(", "));
    assert.ok(temperature.every((label) => label.length <= 8), temperature.join(", "));
  } finally {
    await view.unmount();
    Object.defineProperty(proto, "getBoundingClientRect", box);
    for (const name of ["clientWidth", "clientHeight", "offsetWidth", "offsetHeight"]) delete proto[name];
  }
});


test("reference XYZ plots keep the first geometry and energy; unknown history has no current marker", async () => {
  const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
  const { serializeXyz } = await import("../apps/desktop/src/lib/molecular-workbench/xyz");
  const parsed = parseScientificFile("steps.xyz", "2\nEnergy=-1.25 Hartree\nC 0 0 0\nO 1 0 0\n2\nEnergy=-2.5 Hartree\nC 0 0 0\nO 2 0 0\n");
  for (const referenceFrameIndex of [0, undefined]) {
    const science = { ...parsed, referenceFrameIndex };
    const view = await mount(<PlotsPanel document={doc} science={science} sourceText={serializeXyz(science.atoms,"reference")} actions={{runStructureViewerAction:async()=>{throw new Error("A reference scene cannot seek history");}}}/>);
    try {
      const input=view.host.querySelector('[aria-label="Atom numbers to measure"]');
      await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(input,"1 2");input.dispatchEvent(new window.Event("input",{bubbles:true}));});
      assert.deepEqual(Array.from(activeNative.science.binding(activeNative.viewer).positions),[0,0,0,1,0,0]);
      assert.equal(view.host.querySelector('[role="slider"]'),null);
      if(referenceFrameIndex===0) {
        assert.ok(view.host.textContent.includes("Frame 1 of 2"));
        assert.ok(view.host.textContent.includes("E -1.250000 Eh"));
        assert.ok(view.host.textContent.includes("Distance, Å1.000"));
      } else {
        assert.ok(view.host.textContent.includes("2 frames"));
        assert.ok(!view.host.textContent.includes("E -1."));
        assert.equal(view.host.querySelector('.workbench-chart-current'),null);
      }
    } finally {await view.unmount();}
  }
});

test("undefined historical dihedrals are SVG gaps and keep frame indices distinct from a real zero", async () => {
  const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
  const raw = ["C 0 1 0\nC 0 0 0\nC 1 0 0\nC 1 1 1", "C 0 1 0\nC 0 0 0\nC 1 0 0\nC 1 0 1", "C -1 0 0\nC 0 0 0\nC 1 0 0\nC 2 0 0", "C 0 1 0\nC 0 0 0\nC 1 0 0\nC 1 1 -1", "C 0 1 0\nC 0 0 0\nC 1 0 0\nC 1 1 0"].map(coords=>`4\nanalytic dihedral\n${coords}\n`).join("");
  const science = parseScientificFile("dihedrals.xyz", raw), original = JSON.stringify(science), sent = [];
  const proto = window.HTMLElement.prototype, box = Object.getOwnPropertyDescriptor(proto,"getBoundingClientRect");
  Object.defineProperty(proto,"getBoundingClientRect",{configurable:true,value:()=>({x:0,y:0,top:0,left:0,right:640,bottom:144,width:640,height:144})});
  for(const [name,value] of [["clientWidth",640],["clientHeight",144],["offsetWidth",640],["offsetHeight",144]]) Object.defineProperty(proto,name,{configurable:true,get:()=>value});
  const view = await mount(<PlotsPanel document={doc} science={science} actions={{runStructureViewerAction:async(_document,action)=>{sent.push(action.index);}}}/>);
  try {
    await sceneFrame(0,5);
    const input=view.host.querySelector('[aria-label="Atom numbers to measure"]'), before=activeNative.plugin.state.data.getSnapshot();
    await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(input,"1 2 3 4");input.dispatchEvent(new window.Event("input",{bubbles:true}));});
    await act(async()=>{await new Promise(resolve=>window.setTimeout(resolve,20));});
    const section=view.host.querySelector('[aria-label="Dihedral per frame"]'), slider=()=>section.querySelector('[role="slider"]');
    assert.ok(section.textContent.includes("Dihedral, °45.0"));
    assert.deepEqual(activeNative.plugin.state.data.getSnapshot(),before,"measuring history does not change the native scene");
    const d=section.querySelector('.recharts-line path.recharts-curve').getAttribute("d"), points=[...d.matchAll(/[ML]([\d.-]+),([\d.-]+)/gu)].map(m=>[Number(m[1]),Number(m[2])]);
    assert.equal((d.match(/M/gu)??[]).length,2,"two drawn segments separated by the missing frame");
    assert.equal(points.length,4,"all four defined frames, no manufactured zero at frame3");
    const step=points[1][0]-points[0][0];assert.ok(Math.abs(points[2][0]-points[1][0]-2*step)<.01,"the missing frame keeps its x position");
    const ticks=[...section.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')].map(node=>[Number(node.textContent),Number(node.getAttribute("y"))]);
    const [low,high]=[ticks[0],ticks.at(-1)];for(const [i,value] of [45,90,-45,0].entries()) assert.ok(Math.abs(points[i][1]-(low[1]+(value-low[0])*(high[1]-low[1])/(high[0]-low[0])))<.005);
    await key(slider(),"ArrowRight");await key(slider(),"ArrowRight");
    assert.equal(activeNative.index(),2);assert.equal(slider().getAttribute("aria-valuenow"),"3");assert.equal(slider().getAttribute("aria-valuetext"),"Frame 3");
    assert.equal(section.querySelector('.workbench-chart-current'),null);assert.equal(section.querySelector('.recharts-reference-dot'),null);
    assert.deepEqual(Array.from(activeNative.science.binding(activeNative.viewer).positions),[-1,0,0,0,0,0,1,0,0,2,0,0]);
    await key(slider(),"End");assert.equal(activeNative.index(),4);assert.match(slider().getAttribute("aria-valuetext"),/^Frame 5, Dihedral 0.0 °$/u);
    assert.deepEqual(sent,[1,2,4]);assert.equal(JSON.stringify(science),original);
  } finally {await view.unmount();if(box)Object.defineProperty(proto,"getBoundingClientRect",box);else Reflect.deleteProperty(proto,"getBoundingClientRect");for(const name of ["clientWidth","clientHeight","offsetWidth","offsetHeight"])Reflect.deleteProperty(proto,name);}
});

test("an optimization log plots the printed convergence of each step on a chosen item", async () => {
  const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
  const { readFileSync } = await import("node:fs");
  const science = parseScientificFile("dvb_gopt.out", readFileSync(new URL("fixtures/quantum/gaussian/cclib-dvb_gopt.out", import.meta.url), "utf8"));
  const view = await mount(<PlotsPanel document={doc} science={science} actions={{ runStructureViewerAction: async () => {} }} />);
  try {
    const select = view.host.querySelector('select[aria-label="Convergence value"]');
    assert.deepEqual([...select.options].map((option) => option.textContent), ["Max force", "RMS force", "Max step", "RMS step"]);
    await sceneFrame(0, 5);
    assert.equal(view.host.querySelector('[role="slider"][aria-label="Max force, Eh/bohr frame"]').getAttribute("aria-valuetext"), "Frame 1, Max force 6.07e-2 Eh/bohr");
    await act(async () => { select.value = "rmsStep"; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
    assert.equal(view.host.querySelector('[role="slider"][aria-label="RMS step, a.u. frame"]').getAttribute("aria-valuetext"), "Frame 1, RMS step 1.39e-1 a.u.");
    // The final geometry carries the last Berny table, the one that converged.
    await sceneFrame(4, 5);
    assert.equal(view.host.querySelector('[role="slider"][aria-label="RMS step, a.u. frame"]').getAttribute("aria-valuetext"), "Frame 5, RMS step 1.34e-4 a.u.");
  } finally { await view.unmount(); }
  const plain = await mount(<PlotsPanel document={doc} science={{ format: "xyz", atoms: atoms(0), frames: [0, 0.01].map((shift) => ({ atoms: atoms(shift) })), modes: [], orbitals: [] }} actions={{ runStructureViewerAction: async () => {} }} />);
  try { assert.equal(plain.host.querySelector('[aria-label="Convergence value"]'), null); } finally { await plain.unmount(); }
});
