import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { IDBFactory, forceCloseDatabase } from "fake-indexeddb";

import { readFileSync } from "node:fs";
import type { ViewerDocument } from "../apps/desktop/src/types";

const factory = new IDBFactory(), databases: IDBDatabase[] = [];
const openDatabase = factory.open.bind(factory);
factory.open = (...args: Parameters<typeof factory.open>) => {
  const request = openDatabase(...args); request.addEventListener("success", () => { databases.push(request.result); }); return request;
};
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, Event: browser.Event,
  MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser),
  localStorage: browser.localStorage, indexedDB: factory, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of previous) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const documents = await import("../apps/desktop/src/lib/browser-dev-documents");
const prepareTextDocument = documents.openBrowserDevTextDocument;
let pauseAfterPrepare: ((document: ViewerDocument) => Promise<void>) | null = null;
// Hold the real adapter's completed preparation, never its parser or generated document.
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...documents,
  openBrowserDevTextDocument: async (...args: Parameters<typeof documents.openBrowserDevTextDocument>) => {
    const document = await prepareTextDocument(...args); await pauseAfterPrepare?.(document); return document;
  },
}));
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const { createRoot } = await import("react-dom/client");
const { useAppFileOpen } = await import("../apps/desktop/src/hooks/use-app-file-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { detectContentSpectrumPaths } = await import("../apps/desktop/src/lib/content-spectrum-detection");
const { saveBrowserImport, readBrowserImport } = await import("../apps/desktop/src/lib/browser-import-storage");
const { initializeBrowserImportedFiles, registerDroppedBrowserFiles, webDemoProjectStructures } = await import("../apps/desktop/src/lib/web-demo-workspace");
const { scientificStateFor, importedOriginalFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");

function deferred<T = void>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
const { useAppStartupEffects } = await import("../apps/desktop/src/hooks/use-app-startup-effects");
const { useTabWorkspaceStore } = await import("../apps/desktop/src/stores/tab-workspace-store");
const { workspaceStorage, isBrowserSessionWorkspace } = await import("../apps/desktop/src/lib/window-scope");
async function fixture(restore = false) {
  const original = useMoleculeStore.getState().documents, ordinary: string[] = [], errors: unknown[] = [];
  let api!: ReturnType<typeof useAppFileOpen>;
  const store = useMoleculeStore.getState(), noop = () => {};
  const options: Parameters<typeof useAppFileOpen>[0] = { ...store, preferences: { ...defaultPreferences, rendererMode: "molstar" },
    addProjectRoot: noop, detectContentSpectrumPaths, expandStructureBundles: async paths => paths,
    openDockTab: noop, openDocumentTab: path => { ordinary.push(path); }, openFepNetworkTab: noop,
    pushErrorStatus: error => { errors.push(error); }, pushStatus: noop, rememberRecentStructures: noop,
    setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop,
  };
  function Probe() { api = useAppFileOpen(options); if (restore) useAppStartupEffects({ ...store, activeDocument: null, browserDevExplicitFolders: [], addProjectRoot: noop, setExpandedProjectIds: noop, setWorkspacePath: noop, openPaths: api.openPaths, openDocuments: api.openDocuments, openDockingDocument: async () => null, pushErrorStatus: options.pushErrorStatus }); return null; }
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement); await act(async () => root.render(<Probe />));
  return { api, ordinary, errors, async close() {
    pauseAfterPrepare = null;
    for (const document of useMoleculeStore.getState().documents) if (!original.includes(document)) documents.deleteBrowserDevVirtualTextDocument(document.path);
    useMoleculeStore.getState().setDocuments(original); releaseClosedImports(new Set(original.map(document => document.id)));
    await act(async () => root.unmount()); host.remove();
  } };
}

const bytes = readFileSync(new URL("./fixtures/quantum/gaussian16-water-raman.fchk", import.meta.url));
async function settle(check: () => boolean) {
  for (let n = 0; n < 100 && !check(); n++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(check()).toBe(true);
}
const storeKey = "burette.molecule.session";
function releasePage() {
  for (const doc of useMoleculeStore.getState().documents) documents.deleteBrowserDevVirtualTextDocument(doc.path);
  releaseClosedImports(new Set());
  useMoleculeStore.setState({ documents: [], textDocuments: [], tabs: [], activeTabId: null, activeDocumentId: null });
}


const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { readBrowserSourceCheckpoint } = await import("../apps/desktop/src/lib/browser-source-checkpoint");
const { recordImportedRevision } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
const { serializeXyz } = await import("../apps/desktop/src/lib/molecular-workbench/xyz");
async function sourceFixture(doc: ViewerDocument) {
  let controller!: ReturnType<typeof useSourceEditingController>;
  const errors: unknown[] = [], dock: string[] = [];
  const options = {activeDocument: doc, preferences: defaultPreferences, pushErrorStatus: (error: unknown)=>errors.push(error),
    setDockOpen: ()=>{}, setDockActiveTab: (_area: "right"|"bottom", kind: string)=>dock.push(kind)};
  function Probe(){controller=useSourceEditingController(options);return null;}
  const host=browser.document.createElement("div"), root=createRoot(host as unknown as HTMLElement);browser.document.body.append(host);
  await act(async()=>root.render(<Probe/>));
  return { get api(){return controller;}, errors, dock, async close(){await act(async()=>root.unmount());host.remove();} };
}
async function checkpointMatches(path: string, text: string) {
  for(let n=0;n<100;n++){
    const saved: { value: Awaited<ReturnType<typeof readBrowserSourceCheckpoint>> } = { value: null };
    await act(async()=>{saved.value=await readBrowserSourceCheckpoint(path);});
    if(saved.value?.text===text)return saved.value;
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
  }
  throw new Error("Checkpoint did not commit");
}

test("edited internal-coordinate revision reloads as a fresh dirty session with exact Original and close protection",async()=>{
  const saved=await registerDroppedBrowserFiles([new File([bytes],"edited-reload.fchk")],16*1024*1024);
  const page=await fixture();await act(async()=>{await page.api.openPaths(saved.paths);});
  const doc=useMoleculeStore.getState().documents[0], source=await sourceFixture(doc);
  await act(async()=>{await source.api.beginEditing(doc);});
  const originalSession=source.api.sessionForDocument(doc)!;
  const zmat=parseScientificFile("water.zmat","O\nX 1 1\nH 1 R 2 A\nH 1 R 2 A 3 180\n\nR = 1.1\nA = 52.26\n");
  const editedText=serializeXyz(zmat.atoms,"edited checkpoint");
  expect(recordImportedRevision(doc.id,originalSession.content,{text:editedText,document:zmat})).not.toBeNull();
  await act(async()=>source.api.updateDraft(doc,editedText,{previewApplied:true}));
  const first=await checkpointMatches(doc.path,editedText);
  expect(first.science?.internalCoordinates).toEqual(zmat.internalCoordinates);
  const persisted=browser.sessionStorage.getItem(storeKey)!;
  await source.close();await page.close();releasePage();
  browser.sessionStorage.setItem(storeKey,persisted);await useMoleculeStore.persist.rehydrate();
  const reloaded=await fixture(true);await settle(()=>useMoleculeStore.getState().documents.length===1);
  const nextDoc=useMoleculeStore.getState().documents[0], recovered=await sourceFixture(nextDoc);
  try {
    await settle(()=>recovered.api.sessionForDocument(nextDoc)?.dirty===true);
    const session=recovered.api.sessionForDocument(nextDoc)!;
    expect([session.content,session.dirty]).toEqual([editedText,true]);
    expect(session.sessionId).not.toBe(originalSession.sessionId);
    expect(recovered.dock).toEqual([]);
    expect(scientificStateFor(nextDoc.id,session.content).revision?.document.internalCoordinates).toEqual(zmat.internalCoordinates);
    expect(new Uint8Array(await importedOriginalFor(nextDoc.id)!.file.arrayBuffer())).toEqual(new Uint8Array(bytes));
    let prompts=0;Object.defineProperty(browser,"confirm",{configurable:true,value:()=>{prompts++;return false;}});
    let closed=true;await act(async()=>{closed=await recovered.api.closeDocuments([nextDoc.id]);});
    expect([closed,prompts,recovered.api.sessionForDocument(nextDoc)?.dirty]).toEqual([false,1,true]);
    await settle(()=>recovered.api.sessionForDocument(nextDoc)?.sourcePreview?.slots.secondary?.identity!==undefined);
    const identity=recovered.api.sessionForDocument(nextDoc)!.sourcePreview!.slots.secondary!.identity!;
    const iframe=browser.document.createElement("iframe");browser.document.body.append(iframe);
    await act(async()=>{recovered.api.stagingLoaded(nextDoc,identity,iframe as unknown as HTMLIFrameElement);
      const ready=new browser.MessageEvent("message",{data:{source:"burette-viewer",body:{type:"ready",renderer:"molstar",molstarStructureCount:1}}});
      Object.defineProperty(ready,"source",{value:iframe.contentWindow});browser.dispatchEvent(ready);});
    await settle(()=>recovered.api.sessionForDocument(nextDoc)?.previewState==="current");iframe.remove();
    expect([recovered.api.sessionForDocument(nextDoc)?.dirty,recovered.api.sessionForDocument(nextDoc)?.status]).toEqual([true,"Edited"]);
    expect(recovered.errors).toEqual([]);
    Object.defineProperty(browser,"confirm",{configurable:true,value:()=>true});
    await act(async()=>{closed=await recovered.api.closeDocuments([nextDoc.id]);});
    expect(closed).toBe(true);
    expect(await readBrowserSourceCheckpoint(nextDoc.path)).toBeNull();
  } finally {await recovered.close();await reloaded.close();}
});

const { beginScienceSessionRestore, releaseClosedScienceSessions } = await import("../apps/desktop/src/lib/science-session/state");

test("a source replacement cannot commit its old queued revision, and retains the prior durable draft", async()=>{
  const saved=await registerDroppedBrowserFiles([new File([bytes],"source-replaced.fchk")],16*1024*1024);
  const page=await fixture();await act(async()=>{await page.api.openPaths(saved.paths);});
  const doc=useMoleculeStore.getState().documents.find(doc=>doc.path===saved.paths[0])!, source=await sourceFixture(doc);
  try {
    await act(async()=>{await source.api.beginEditing(doc);});
    const base=source.api.sessionForDocument(doc)!.content, first=base.replace("Energy=", "first Energy=");
    await act(async()=>source.api.updateDraft(doc,first,{previewApplied:true}));
    const checkpoint=await checkpointMatches(doc.path,first);
    await act(async()=>{source.api.updateDraft(doc,first+"\n",{previewApplied:true});beginScienceSessionRestore(doc.id);});
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
    expect(await readBrowserSourceCheckpoint(doc.path)).toEqual(checkpoint);
    expect(source.api.sessionForDocument(doc)).toBeNull();
    expect(source.errors).toEqual([]);
  } finally {await source.close();await page.close();releaseClosedScienceSessions(new Set());}
});

test("confirmed close waits for queued checkpoint removal and cannot resurrect the discarded edit",async()=>{
  const saved=await registerDroppedBrowserFiles([new File([bytes],"closed-draft.fchk")],16*1024*1024);
  const page=await fixture();await act(async()=>{await page.api.openPaths(saved.paths);});
  const doc=useMoleculeStore.getState().documents.find(doc=>doc.path===saved.paths[0])!, source=await sourceFixture(doc);
  try {
    await act(async()=>{await source.api.beginEditing(doc);});
    const base=source.api.sessionForDocument(doc)!.content;
    Object.defineProperty(browser,"confirm",{configurable:true,value:()=>true});
    let closed=false;
    await act(async()=>{source.api.updateDraft(doc,base+"\n",{previewApplied:true});closed=await source.api.closeDocuments([doc.id]);});
    expect(closed).toBe(true);
    expect(await readBrowserSourceCheckpoint(doc.path)).toBeNull();
    expect(new Uint8Array(await (await readBrowserImport(doc.path))!.file.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(source.errors).toEqual([]);
  } finally {await source.close();await page.close();}
});

test("closing before automatic recovery finishes still admits a dirty source and requires confirmation", async()=>{
  const saved=await registerDroppedBrowserFiles([new File([bytes],"early-close.fchk")],16*1024*1024);
  const page=await fixture();await act(async()=>{await page.api.openPaths(saved.paths);});
  const doc=useMoleculeStore.getState().documents.find(doc=>doc.path===saved.paths[0])!, source=await sourceFixture(doc);
  await act(async()=>{await source.api.beginEditing(doc);});
  const text=source.api.sessionForDocument(doc)!.content+"\n";
  await act(async()=>source.api.updateDraft(doc,text,{previewApplied:true}));await checkpointMatches(doc.path,text);
  await source.close();
  const originalArrayBuffer=Blob.prototype.arrayBuffer, entered=deferred(), gate=deferred();
  Blob.prototype.arrayBuffer=async function(){const result=await originalArrayBuffer.call(this);if(this.size===bytes.length){entered.resolve();await gate.promise;}return result;};
  const recovered=await sourceFixture(doc);
  try {
    await entered.promise;
    let prompts=0;Object.defineProperty(browser,"confirm",{configurable:true,value:()=>{prompts++;return false;}});
    let close!:Promise<boolean>;await act(async()=>{close=recovered.api.closeDocuments([doc.id]);gate.resolve();});
    let closed=true;await act(async()=>{closed=await close;});
    expect([closed,prompts,recovered.api.sessionForDocument(doc)?.dirty]).toEqual([false,1,true]);
    expect(recovered.errors).toEqual([]);
  } finally {Blob.prototype.arrayBuffer=originalArrayBuffer;gate.resolve();await recovered.close();await page.close();}
});

test("an unfinished text draft is recovered without attaching the original modes to invalid geometry", async()=>{
  const saved=await registerDroppedBrowserFiles([new File([bytes],"unfinished.fchk")],16*1024*1024);
  const page=await fixture();await act(async()=>{await page.api.openPaths(saved.paths);});
  const doc=useMoleculeStore.getState().documents.find(doc=>doc.path===saved.paths[0])!, source=await sourceFixture(doc);
  await act(async()=>{await source.api.beginEditing(doc);source.api.updateDraft(doc,"unfinished source");});
  expect((await checkpointMatches(doc.path,"unfinished source")).science).toBeNull();
  await source.close();const recovered=await sourceFixture(doc);
  try {
    await settle(()=>recovered.api.sessionForDocument(doc)?.previewState==="paused");
    expect([recovered.api.sessionForDocument(doc)?.content,recovered.api.sessionForDocument(doc)?.dirty]).toEqual(["unfinished source",true]);
    expect(scientificStateFor(doc.id,"unfinished source").revision).toBeNull();
    expect(new Uint8Array(await importedOriginalFor(doc.id)!.file.arrayBuffer())).toEqual(new Uint8Array(bytes));
  } finally {await recovered.close();await page.close();}
});

test("independent: recovered text cannot authorize the old base iframe before preview promotion", async () => {
  const saved = await registerDroppedBrowserFiles([new File([bytes], "old-frame.fchk")], 16 * 1024 * 1024);
  const page = await fixture(); await act(async () => { await page.api.openPaths(saved.paths); });
  const doc = useMoleculeStore.getState().documents.find(item => item.path === saved.paths[0])!;
  const first = await sourceFixture(doc);
  await act(async () => { await first.api.beginEditing(doc); });
  const originalText = first.api.sessionForDocument(doc)!.content;
  const atomLines = originalText.trimEnd().split("\n");
  [atomLines[3], atomLines[4]] = [atomLines[4], atomLines[3]];
  const changed = atomLines.join("\n") + "\n";
  expect(changed).not.toBe(originalText);
  await act(async () => first.api.updateDraft(doc, changed, { previewApplied: true }));
  await checkpointMatches(doc.path, changed); await first.close();
  const gate = deferred();
  pauseAfterPrepare = async () => { await gate.promise; };
  const recovered = await sourceFixture(doc);
  const frame = browser.document.createElement("iframe"); frame.src = doc.runtimePath!; browser.document.body.append(frame);
  try {
    await settle(() => recovered.api.sessionForDocument(doc)?.previewState === "staging");
    expect(recovered.api.sessionForDocument(doc)!.content).toBe(changed);
    expect(documents.readBrowserDevVirtualTextDocument(doc.path)).toBe(originalText);
    expect(recovered.api.ownsCurrentSourceFrame(doc, frame as unknown as HTMLIFrameElement)).toBe(false);
  } finally { gate.resolve(); pauseAfterPrepare = null; frame.remove(); await recovered.close(); await page.close(); }
});

test("independent: closing a background draft refuses close when source admission fails after checkpoint lookup", async () => {
  const saved = await registerDroppedBrowserFiles([new File([bytes], "background-failed-admission.fchk")], 16 * 1024 * 1024);
  const page = await fixture(); await act(async () => { await page.api.openPaths(saved.paths); });
  const doc = useMoleculeStore.getState().documents.find(item => item.path === saved.paths[0])!;
  const first = await sourceFixture(doc);
  await act(async () => { await first.api.beginEditing(doc); });
  const changed = first.api.sessionForDocument(doc)!.content + "\n";
  await act(async () => first.api.updateDraft(doc, changed, { previewApplied: true }));
  const checkpoint = await checkpointMatches(doc.path, changed); await first.close();
  let controller!: ReturnType<typeof useSourceEditingController>;
  const errors: unknown[] = [];
  function Background() { controller = useSourceEditingController({ activeDocument: null, preferences: defaultPreferences,
    pushErrorStatus: error => errors.push(error), setDockOpen: () => {}, setDockActiveTab: () => {} }); return null; }
  const host = browser.document.createElement("div"), root = createRoot(host as unknown as HTMLElement); browser.document.body.append(host);
  await act(async () => root.render(<Background />));
  const arrayBuffer = Blob.prototype.arrayBuffer;
  let reads = 0;
  Blob.prototype.arrayBuffer = async function () {
    if (this.size === bytes.length && ++reads === 2) throw new Error("Independent source admission read failed");
    return arrayBuffer.call(this);
  };
  let prompts = 0; Object.defineProperty(browser, "confirm", { configurable: true, value: () => { prompts++; return false; } });
  try {
    let closed = true; await act(async () => { closed = await controller.closeDocuments([doc.id]); });
    Blob.prototype.arrayBuffer = arrayBuffer;
    const persisted = await readBrowserSourceCheckpoint(doc.path);
    expect({ closed, prompts, session: controller.sessionForDocument(doc), checkpointId: persisted?.id, errors: errors.length })
      .toEqual({ closed: false, prompts: 0, session: null, checkpointId: checkpoint.id, errors: 1 });
  } finally { Blob.prototype.arrayBuffer = arrayBuffer; await act(async () => root.unmount()); host.remove(); await page.close(); }
});

test("paired MCD reference-only edit reloads through the real controller and exports exact paired Originals", async () => {
  const { adoptRestoredScientificSource } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
  const { sha256Hex } = await import("../apps/desktop/src/lib/source-editing/source-identity");
  const { zmatrixDocumentFromAtoms } = await import("../scripts/zmatrix-export.mjs");
  const { editZmatrixRows } = await import("../scripts/zmatrix-rows.mjs");
  const { zmatrixRowsRevision } = await import("../apps/desktop/src/lib/workbench/zmatrix-draft");
  const { atomicNumber } = await import("../apps/desktop/src/lib/molecular-workbench/elements");
  // MolStar's Node scheduler detects global setImmediate; this DOM owns its window side.
  Object.defineProperty(browser, "setImmediate", { configurable: true, value: globalThis.setImmediate });
  Object.defineProperty(browser, "clearImmediate", { configurable: true, value: globalThis.clearImmediate });
  const { PluginContext } = await import("molstar/lib/mol-plugin/context.js");
  const { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
  const { science: nativeScience } = await import("./science-session-fixture");
  const { prepareSceneScienceExport } = await import("../apps/desktop/src/lib/science-session/export");
  const { decodeScienceSession } = await import("../apps/desktop/src/lib/science-session/codec");
  const saved = await registerDroppedBrowserFiles([new File([bytes], "paired-reload.fchk")], 16 * 1024 * 1024);
  const page = await fixture(); await act(async () => { await page.api.openPaths(saved.paths); });
  const doc = useMoleculeStore.getState().documents.find(value => value.path === saved.paths[0])!, source = await sourceFixture(doc);
  await act(async () => { await source.api.beginEditing(doc); });
  const session = source.api.sessionForDocument(doc)!, imported = scientificStateFor(doc.id, session.content), original = imported.original!;
  const data = imported.revision!.document, coordinates = data.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
  const definition = zmatrixDocumentFromAtoms(coordinates), file = new Blob(["10000 -2.25 .12\r\n"]);
  const hashes = { primaryOriginalSha256: await sha256Hex(new Uint8Array(await original.file.arrayBuffer())),
    companionOriginalSha256: await sha256Hex(new Uint8Array(await file.arrayBuffer())), sourceRevisionSha256: await sha256Hex(session.content) };
  const science: typeof data = { ...data, internalCoordinates: definition, frames: data.frames.map((frame, index) => index ? frame : { ...frame,
    mcdCompanion: { ...hashes, spectra: { kind: "scientific-spectra", version: 1,
      source: { name: "explicit.mcd", format: "orca-mcd", scope: "frame", frameIndex: 0, frameCount: data.frames.length },
      atomicNumbers: data.atoms.map(atom => atomicNumber(atom.element)),
      spectra: [{ kind: "mcd", xUnit: "cm^-1", positions: [10000], values: [-2.25], valueUnit: null, auxiliary: [{ name: "absorption", unit: null, values: [.12] }] }] } } }) };
  const companions = [{ role: "orca-mcd" as const, frameIndex: 0, frameCount: data.frames.length, name: "explicit.mcd", file, ...hashes }];
  const origin = { text: session.content, document: science };
  adoptRestoredScientificSource(doc.id, origin, original, companions);
  const edited = zmatrixRowsRevision(science, editZmatrixRows(definition,
    { type: "append", row: { element: "X", refs: [0, 1, 2], values: [2, 90, 90] } }, coordinates), origin.text, [origin]);
  expect(edited.retainedScienceFrom).toBe(origin);
  expect(recordImportedRevision(doc.id, origin.text, edited)).not.toBeNull();
  await act(async () => source.api.updateDraft(doc, edited.text, { previewApplied: true }));
  const checkpoint = await checkpointMatches(doc.path, edited.text).catch(error => { expect(source.errors).toEqual([]); throw error; });
  expect(checkpoint.version).toBe(2);
  expect(checkpoint.science!.frames[0].mcdCompanion!.sourceRevisionSha256).toBe(await sha256Hex(edited.text));
  expect(checkpoint.companions![0].originRevisionSha256).toBe(hashes.sourceRevisionSha256);
  const persisted = browser.sessionStorage.getItem(storeKey)!;
  await source.close(); await page.close(); releasePage();
  browser.sessionStorage.setItem(storeKey, persisted); await useMoleculeStore.persist.rehydrate();
  const nextPage = await fixture(true); await settle(() => useMoleculeStore.getState().documents.length === 1);
  const nextDoc = useMoleculeStore.getState().documents[0], recovered = await sourceFixture(nextDoc), plugin = new PluginContext(DefaultPluginSpec());
  try {
    await settle(() => recovered.api.sessionForDocument(nextDoc)?.dirty === true);
    const nextSession = recovered.api.sessionForDocument(nextDoc)!;
    expect([nextSession.content, nextSession.dirty]).toEqual([edited.text, true]);
    expect(nextSession.sessionId).not.toBe(session.sessionId);
    const recoveredState = scientificStateFor(nextDoc.id, edited.text);
    expect(recoveredState.revision!.retainedScienceFrom).toBeUndefined();
    expect(recoveredState.companions).toHaveLength(1);
    expect(recoveredState.revision!.document.internalCoordinates).toEqual(edited.document.internalCoordinates);
    expect(new Uint8Array(await recoveredState.companions![0].file.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
    await settle(() => recovered.api.sessionForDocument(nextDoc)?.sourcePreview?.slots.secondary?.identity !== undefined);
    const identity = recovered.api.sessionForDocument(nextDoc)!.sourcePreview!.slots.secondary!.identity!;
    const iframe = browser.document.createElement("iframe"); browser.document.body.append(iframe);
    await act(async () => { recovered.api.stagingLoaded(nextDoc, identity, iframe as unknown as HTMLIFrameElement);
      const ready = new browser.MessageEvent("message", { data: { source: "burette-viewer", body: { type: "ready", renderer: "molstar", molstarStructureCount: 1 } } });
      Object.defineProperty(ready, "source", { value: iframe.contentWindow }); browser.dispatchEvent(ready); });
    await settle(() => recovered.api.sessionForDocument(nextDoc)?.previewState === "current"); iframe.remove();
    await plugin.init();
    const raw = await plugin.builders.data.rawData({ data: edited.text, label: "recovered.xyz" });
    const trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
    const prepared = await prepareSceneScienceExport(nextDoc, { sourceEditing: recovered.api, sceneFileCount: 1, isOpen: () => true,
      request: (async () => nativeScience.binding({ plugin })) as never });
    expect(prepared?.kind).toBe("science"); if (prepared?.kind !== "science") throw new Error("Expected recovered science export");
    const blob: Blob = await nativeScience.serialize({ plugin }, prepared.action.science, { type: "molx", params: { camera: false, image: false } });
    await prepared.confirm();
    const decoded = (await decodeScienceSession(new Uint8Array(await blob.arrayBuffer())))!;
    expect(decoded.source.text).toBe(edited.text);
    expect(decoded.science).toEqual(checkpoint.science);
    expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(new Uint8Array(await decoded.companions![0].file.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
    expect(decoded.companions![0].originRevisionSha256).toBe(hashes.sourceRevisionSha256);
    expect(recovered.errors).toEqual([]);
  } finally { plugin.dispose(); await recovered.close(); await nextPage.close(); }
});

test("checkpoint snapshot failure reports through the controller while preserving dirty text and the prior durable draft", async () => {
  const saved = await registerDroppedBrowserFiles([new File([bytes], "invalid-snapshot.fchk")], 16 * 1024 * 1024);
  const page = await fixture(); await act(async () => { await page.api.openPaths(saved.paths); });
  const doc = useMoleculeStore.getState().documents.find(value => value.path === saved.paths[0])!, source = await sourceFixture(doc);
  try {
    await act(async () => { await source.api.beginEditing(doc); });
    const base = source.api.sessionForDocument(doc)!.content, science = scientificStateFor(doc.id, base).revision!.document;
    const first = base + "\n";
    await act(async () => source.api.updateDraft(doc, first, { previewApplied: true }));
    const prior = await checkpointMatches(doc.path, first), next = base + "\n\n";
    expect(recordImportedRevision(doc.id, base, { text: next, document: { ...science, extraBinary: new Blob(["unsupported metadata"]) } as typeof science })).not.toBeNull();
    await act(async () => { expect(() => source.api.updateDraft(doc, next, { previewApplied: true })).not.toThrow(); });
    await settle(() => source.errors.length === 1);
    expect([source.api.sessionForDocument(doc)?.content, source.api.sessionForDocument(doc)?.dirty]).toEqual([next, true]);
    expect(await readBrowserSourceCheckpoint(doc.path)).toEqual(prior);
  } finally { await source.close(); await page.close(); }
});
