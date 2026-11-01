import { afterAll, expect, test } from "bun:test";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { browser } from "./test-cjson-import.test";
import { fixture, closeRuntime, NativeFile } from "./fixtures/retained-trajectory-native.mjs";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { useRetainedTrajectorySource } from "../apps/desktop/src/lib/workbench/retained-trajectory-source";
import { useScientificDocument } from "../apps/desktop/src/lib/workbench/source";
import { openScientificDocument } from "../apps/desktop/src/lib/workbench/generated-document-open";
import { openScientificFiles } from "../apps/desktop/src/lib/workbench/open";
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { openBrowserDevTextDocument, readBrowserDevVirtualTextDocument, deleteBrowserDevVirtualTextDocument } from "../apps/desktop/src/lib/browser-dev-documents";
import { useMoleculeStore } from "../apps/desktop/src/stores/molecule-store";
import { defaultPreferences } from "../apps/desktop/src/stores/settings-store";
import { scientificStateFor } from "../apps/desktop/src/lib/workbench/scientific-source-state";
const { createRoot } = await import("react-dom/client");
afterAll(closeRuntime);
const opened: ViewerDocument[] = [];
const actions = { openStructureRecords: async (records: Array<{ path: string; inputExtension: string; text: string }>) => {
  const docs = await Promise.all(records.map(record => openBrowserDevTextDocument(record.path, record.inputExtension, record.text, { ...defaultPreferences, rendererMode: "molstar" })));
  opened.push(...docs); useMoleculeStore.setState(state => ({ documents: [...state.documents, ...docs] })); return docs;
} };
async function wait(predicate: () => boolean) {
  for (let i = 0; i < 60; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); if (predicate()) return; }
  throw new Error("Retained trajectory source did not settle");
}
function Probe({ owner }: { owner: ViewerDocument }) {
  const state = useScientificDocument(owner);
  return state.document && state.text !== null ? <Cursor owner={owner} science={state.document} text={state.text} /> : <output>none</output>;
}
function Cursor({ owner, science, text }: { owner: ViewerDocument; science: ReturnType<typeof parseScientificFile>; text: string }) {
  const source = useRetainedTrajectorySource(owner, science, text);
  return <><output>{source.cursor === null ? "none" : `${source.cursor}/${science.frames.length}`}</output>
    <button disabled={!source.seek} onClick={() => source.seek?.(1)}>Next</button>{source.error}</>;
}
async function mount(owner: ViewerDocument, text: string, format = "xyz") {
  const native = await fixture(text, format), frame = document.createElement("iframe"); frame.className = "viewer-iframe"; frame.dataset.documentId = owner.id; frame.dataset.renderer = "molstar"; document.body.append(frame);
  const sent: Record<string, unknown>[] = []; let hold: Promise<void> | null = null;
  frame.contentWindow!.postMessage = message => {
    if (message.body.type === "agent-action-cancel") return;
    const action = message.body.action; sent.push(action);
    void (async () => {
      const pending = hold; hold = null; await pending;
      let result; try { result = await native.execute(action); } catch (error) { result = { ok: false, error: { message: String(error) } }; }
      window.dispatchEvent(new browser.MessageEvent("message", { source: frame.contentWindow as never, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: message.body.id, result } } }) as unknown as MessageEvent);
    })();
  };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const emit = async () => act(async () => { window.dispatchEvent(new browser.CustomEvent("burette:trajectory-frame-changed", { detail: { documentId: owner.id, frameIndex: native.index(), frameCount: native.expected().frameCount } }) as unknown as Event); });
  await emit(); await act(async () => root.render(<Probe owner={owner} />));
  return { host, root, native, frame, sent, emit, hold: () => { let release!: () => void; hold = new Promise(resolve => release = resolve); return release; },
    close: async () => { await act(async () => root.unmount()); host.remove(); frame.remove(); native.close(); for (const doc of opened.splice(0)) deleteBrowserDevVirtualTextDocument(doc.path); } };
}

test("normal producer CJSON active0/5 keeps seven source sets and native0/1 without a seek", async () => {
  for (const active of [0, 5]) {
    const primary = JSON.parse(readFileSync(new URL("./fixtures/trajectory/retained-nmr.cjson", import.meta.url), "utf8"));
    if (active) primary.atoms.coords["3dSetsActive"] = active;
    const raw = JSON.stringify(primary); await openScientificFiles(actions, [new File([raw], "retained.cjson")]);
    const owner = opened.at(-1)!, text = readBrowserDevVirtualTextDocument(owner.path)!, science = scientificStateFor(owner.id, text).revision!.document;
    const f = await mount(owner, text, "mol");
    try {
      await wait(() => f.host.querySelector("output")?.textContent === `${active}/7`);
      expect(f.host.querySelector("button")!.disabled).toBe(true); expect(f.native.index()).toBe(0); expect(f.native.expected().frameCount).toBe(1);
      expect(f.sent).toHaveLength(0); expect(science.frames).toHaveLength(7); expect(science.graph!.activeFrameIndex).toBe(active);
      expect(Object.keys(science.frames[active])).toEqual(["atoms"]);
      const [c, o] = science.frames[active].atoms; expect(Math.hypot(o.x-c.x,o.y-c.y,o.z-c.z)).toBeCloseTo(active ? 1.2003876259138908 : 1.2006257364669461,12);
      expect(science.spectra!.source.scope).toBe("file");
      expect(science.spectra!.spectra[0]).toEqual({ kind: "nmr", quantity: "native-input", atomIndices: [0,1,2,3], valuesPpm: [8.356,-394.078,21.901,21.901] });
    } finally { await f.close(); }
  }
});

test("final XYZ cursor follows declared reference; steps require exact native source before seek", async () => {
  const raw = "2\nfirst\nC 0 0 0\nO 1 0 0\n2\nsecond\nC 0 0 0\nO 2 0 0\n", science = parseScientificFile("steps.xyz", raw);
  for (const layout of ["final", "steps"] as const) {
    await openScientificDocument(actions, "steps", science, layout); const owner = opened.at(-1)!, text = readBrowserDevVirtualTextDocument(owner.path)!;
    const f = await mount(owner, text);
    try {
      await wait(() => f.host.querySelector("output")?.textContent === "0/2");
      expect(f.host.querySelector("button")!.disabled).toBe(layout === "final");
      if (layout === "steps") {
        await act(async () => f.host.querySelector("button")!.click()); await wait(() => f.native.index() === 1); await f.emit();
        await wait(() => f.host.querySelector("output")?.textContent === "1/2");
        expect(f.sent.filter(action => action.type === "set_structure_pose")).toHaveLength(1);
        expect(f.sent.find(action => action.type === "set_structure_pose")!.expected).toBeDefined();
      }
    } finally { await f.close(); }
  }
});

test("same-count foreign source and held old reads cannot enable a replacement document", async () => {
  const raw = "2\nfirst\nC 0 0 0\nO 1 0 0\n2\nsecond\nC 0 0 0\nO 2 0 0\n";
  await openScientificDocument(actions, "owned", parseScientificFile("steps.xyz", raw), "steps");
  const owner = opened.at(-1)!, text = readBrowserDevVirtualTextDocument(owner.path)!;
  const f = await mount(owner, text.replace("Step 1", "Foreign"));
  try {
    await wait(() => f.sent.length === 1); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(f.host.querySelector("output")!.textContent).toBe("none"); expect(f.host.querySelector("button")!.disabled).toBe(true); expect(f.native.index()).toBe(0);
    const release = f.hold(); await f.emit(); await wait(() => f.sent.length === 2);
    await act(async () => f.root.render(<Probe owner={{ ...owner, id: "replacement", path: "/replacement.mol", extension: "mol" }} />));
    release(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(f.host.querySelector("output")!.textContent).toBe("none"); expect(f.native.index()).toBe(0);
  } finally { await f.close(); }
});


test("final import keeps producer reference geometry, its own energy and exact Original across native MOLX", async () => {
  const { encodeScienceSession, decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
  for (const [name, relative, reference, positions, energy] of [
    ["steps.xyz","trajectory/reference/authored-two-frame.xyz",0,[0,0,0,1,0,0],-1.25],
    ["steps.out","quantum/dispatcher/two-step-orca.out",1,[0,0,0,0,0,.7],-1.2],
  ] as const) {
    const raw = readFileSync(new URL(`./fixtures/${relative}`, import.meta.url)), science = parseScientificFile(name,raw.toString());
    await openScientificDocument(actions,name,science,"final",{name,file:new Blob([raw])});
    const owner = opened.at(-1)!, text = readBrowserDevVirtualTextDocument(owner.path)!, f = await mount(owner,text);
    try {
      await wait(() => f.host.querySelector("output")?.textContent === `${reference}/2`);
      expect(text.split("\n")[1]).toContain(`Energy=${energy} Hartree`);
      const runtime = f.native.science, report = runtime.binding(f.native.viewer);
      for (const [i,coordinate] of positions.entries()) expect(report.positions[i]).toBeCloseTo(coordinate,6);
      const binding = Object.fromEntries(["structureRef","modelRef","trajectoryRef","frameIndex","frameCount","atomCount"].map(k=>[k,report[k]]));
      const encoded = await encodeScienceSession({documentUuid:crypto.randomUUID(),source:{extension:"xyz",text},atomIds:["reference-a","reference-b"],binding:binding as never,science,original:{name,file:new Blob([raw])}});
      const blob = await runtime.serialize(f.native.viewer,{binding,positions:report.positions,assets:encoded.assets},{type:"molx",params:{camera:false,image:false}});
      const bytes = new Uint8Array(await blob.arrayBuffer()), decoded = (await decodeScienceSession(bytes))!;
      expect(decoded.science).toEqual(science); expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(new Uint8Array(raw));
      const token = runtime.beginImport(f.native.plugin); await f.native.plugin.managers.snapshot.open(new NativeFile([bytes],"reference.molx"));
      expect(runtime.completeImport(f.native.plugin,token)).toBe(true);
      const reopened = runtime.binding(f.native.viewer);
      for (const [i,coordinate] of positions.entries()) expect(reopened.positions[i]).toBeCloseTo(coordinate,6);
      expect([reopened.frameIndex,reopened.frameCount]).toEqual([0,1]);
    } finally { await f.close(); }
  }
});

test("legacy unique and duplicate histories stay unknown through native reopen and resave, while global modes and spectra survive", async () => {
  const { encodeScienceSession, decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
  for (const name of ["authored-legacy-unknown","authored-legacy-duplicate-geometry"]) {
    const raw = readFileSync(new URL(`./fixtures/trajectory/reference/${name}.molx`, import.meta.url));
    let decoded = (await decodeScienceSession(raw))!;
    const expected = JSON.parse(readFileSync(new URL(`./fixtures/trajectory/reference/${name}.json`,import.meta.url),"utf8"));
    expect(decoded.science).toEqual(expected); expect(decoded.science!.referenceFrameIndex).toBeUndefined();
    // Reopen the original actual native archive, then reserialize the same full scientific payload.
    const native = await fixture(decoded.source.text), runtime = native.science;
    try {
      const token = runtime.beginImport(native.plugin); await native.plugin.managers.snapshot.open(new NativeFile([raw],`${name}.molx`));
      expect(runtime.completeImport(native.plugin,token)).toBe(true);
      const report = runtime.binding(native.viewer); expect(Array.from(report.positions)).toEqual([0,0,0,1,0,0]);
      const { restoreScienceSession } = await import("../apps/desktop/src/lib/science-session/restore");
      const restoredOwner = { id:crypto.randomUUID(),title:`${name}.molx`,path:`/${name}.molx`,extension:"molx",renderer:"molstar",byteCount:raw.length } as ViewerDocument;
      expect(await restoreScienceSession(restoredOwner,{readBytes:async()=>new Uint8Array(raw),isOpen:()=>true,request:(async (_id: string,action: Parameters<typeof import("../apps/desktop/src/lib/viewer-bridge").requestViewerAction>[1])=> {
        if(action.type==="workspace_scene_state") return {ready:true};
        if(action.type==="scene_science_binding") return runtime.binding(native.viewer);
        if(action.type==="scene_science_restore_ack") return {adopted:await runtime.adoptValidated(native.viewer,action)};
        throw new Error(`Unexpected action ${action.type}`);
      }) as never})).toBe("restored");
      expect(scientificStateFor(restoredOwner.id,decoded.source.text).revision!.document).toEqual(expected);
      const encoded = await encodeScienceSession(decoded);
      const blob = await runtime.serialize(native.viewer,{binding:decoded.binding,positions:report.positions,assets:encoded.assets},{type:"molx",params:{camera:false,image:false}});
      decoded = (await decodeScienceSession(new Uint8Array(await blob.arrayBuffer())))!;
      expect(decoded.science).toEqual(expected); expect(decoded.science!.referenceFrameIndex).toBeUndefined();
      expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(new Uint8Array(readFileSync(new URL("./fixtures/trajectory/reference/authored-two-frame.xyz",import.meta.url))));
      await openScientificDocument(actions,name,decoded.science!,"final");
      const owner=opened.at(-1)!,text=readBrowserDevVirtualTextDocument(owner.path)!; expect(text.split("\n")[1]).not.toContain("Energy=");
      const f=await mount(owner,text);
      try { await wait(()=>f.host.querySelector("output")?.textContent==="none"); expect(f.host.querySelector("button")!.disabled).toBe(true); }
      finally { await f.close(); }
    } finally { native.close(); }
  }
});
