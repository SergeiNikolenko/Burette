import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { IDBFactory } from "fake-indexeddb";

import { readFileSync } from "node:fs";
import type { ViewerDocument } from "../apps/desktop/src/types";

const factory = new IDBFactory();
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
const { registerDroppedBrowserFiles } = await import("../apps/desktop/src/lib/web-demo-workspace");
const { scientificStateFor, importedOriginalFor, releaseClosedImports } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");

function deferred<T = void>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
const { useAppStartupEffects } = await import("../apps/desktop/src/hooks/use-app-startup-effects");
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
const { captureBrowserMcdAdmission, readBrowserScientificAttachment } = await import("../apps/desktop/src/lib/workbench/browser-mcd-attachment");
const { logicalSourceFor } = await import("../apps/desktop/src/lib/science-session/state");
const sidecar = () => new File(["10000 -2.25 .12\r\n12000 1.5 .25\r\n9000 -.5 .1\r\n"], "selected.mcd");
async function openSource(name: string) {
 const saved=await registerDroppedBrowserFiles([new File([bytes],name)],16*1024*1024);
 const page=await fixture();await act(async()=>page.api.openPaths(saved.paths));
 const doc=useMoleculeStore.getState().documents.find(value=>value.path===saved.paths[0])!,controller=await sourceFixture(doc);
 const text=documents.readBrowserDevVirtualTextDocument(doc.path)!,science=scientificStateFor(doc.id,text).revision!.document;
 return {page,doc,controller,text,science,capture:()=>captureBrowserMcdAdmission({document:doc,science,sourceText:text,sourceFrameIndex:0,sourceEditing:controller.api}),
  close:async()=>{await controller.close();await page.close();}};
}

test("ordinary clean companion admission survives close/reopen and startup reload without dirty text or source-token changes",async()=>{
 const view=await openSource("clean-companion.fchk"),owner=view.capture();
 try{
  const original=importedOriginalFor(view.doc.id)!;
  const prepared=await owner.prepare(sidecar());expect(prepared.blocks).toEqual([{index:0,rows:2,fromCm1:10000,toCm1:12000},{index:1,rows:1,fromCm1:9000,toCm1:9000}]);
  await act(async()=>prepared.apply(1));
  expect([documents.readBrowserDevVirtualTextDocument(view.doc.path),view.controller.api.sessionForDocument(view.doc),logicalSourceFor(view.doc.id)]).toEqual([view.text,null,null]);
  expect(await readBrowserSourceCheckpoint(view.doc.path)).toBeNull();
  const first=scientificStateFor(view.doc.id,view.text);const signal=first.revision!.document.frames[0].mcdCompanion!.spectra.spectra[0];if(signal.kind!=='mcd')throw new Error('Expected MCD');expect(signal.values).toEqual([-.5]);
  expect(first.original).toBe(original);expect(await first.companions![0].file.text()).toBe(await sidecar().text());
  const persisted=(await readBrowserScientificAttachment(view.doc.path))!;expect(persisted.text).toBe(view.text);
  Object.assign(browser,{setImmediate:globalThis.setImmediate,clearImmediate:globalThis.clearImmediate});
  const {PluginContext}=await import('molstar/lib/mol-plugin/context.js');const {DefaultPluginSpec}=await import('molstar/lib/mol-plugin/spec.js');
  const {science:nativeScience}=await import('./science-session-fixture');const {prepareSceneScienceExport}=await import('../apps/desktop/src/lib/science-session/export');
  const {decodeScienceSession}=await import('../apps/desktop/src/lib/science-session/codec');const plugin=new PluginContext(DefaultPluginSpec());
  try{await plugin.init();const raw=await plugin.builders.data.rawData({data:view.text});const trajectory=await plugin.builders.structure.parseTrajectory(raw,'xyz');
   await plugin.builders.structure.hierarchy.applyPreset(trajectory,'default',{representationPreset:'empty'});
   const exported=await prepareSceneScienceExport(view.doc,{sourceEditing:view.controller.api,sceneFileCount:1,isOpen:()=>true,request:(async()=>nativeScience.binding({plugin})) as never});
   expect(exported?.kind).toBe('science');if(exported?.kind!=='science')throw new Error('Expected clean scientific export');
   const archive:Blob=await nativeScience.serialize({plugin},exported.action.science,{type:'molx',params:{camera:false,image:false}});await exported.confirm();
   const decoded=(await decodeScienceSession(new Uint8Array(await archive.arrayBuffer())))!;
   expect(decoded.source.text).toBe(view.text);expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(new Uint8Array(bytes));
   expect(await decoded.companions![0].file.text()).toBe(await sidecar().text());
   const savedSignal=decoded.science!.frames[0].mcdCompanion!.spectra.spectra[0];if(savedSignal.kind!=='mcd')throw new Error('Expected MCD');expect(savedSignal.values).toEqual([-.5]);
  }finally{plugin.dispose();}

  await view.controller.close();
  useMoleculeStore.getState().setDocuments([]);releaseClosedImports(new Set());documents.deleteBrowserDevVirtualTextDocument(view.doc.path);
  await act(async()=>view.page.api.openPaths([view.doc.path]));
  const reopened=useMoleculeStore.getState().documents.find(value=>value.path===view.doc.path)!;
  expect(reopened).not.toBe(view.doc);expect(reopened.title).toBe(view.doc.title);
  expect(documents.readBrowserDevVirtualTextDocument(reopened.path)).toBe(view.text);
  expect(scientificStateFor(reopened.id,view.text).revision!.document).toEqual(first.revision!.document);
  const clean=await sourceFixture(reopened);expect(clean.api.sessionForDocument(reopened)).toBeNull();await clean.close();
  const session=browser.sessionStorage.getItem(storeKey)!;await view.page.close();releasePage();browser.sessionStorage.setItem(storeKey,session);await useMoleculeStore.persist.rehydrate();
  const page=await fixture(true);await settle(()=>useMoleculeStore.getState().documents.length===1);
  try{const restored=useMoleculeStore.getState().documents[0],state=scientificStateFor(restored.id,view.text);
   expect(documents.readBrowserDevVirtualTextDocument(restored.path)).toBe(view.text);
   expect(state.revision!.document).toEqual(first.revision!.document);
   expect(new Uint8Array(await state.original!.file.arrayBuffer())).toEqual(new Uint8Array(bytes));
   expect(await state.companions![0].file.text()).toBe(await sidecar().text());expect(page.errors).toEqual([]);
  }finally{await page.close();}
 }finally{owner.release();await view.close();}
});

test("capture before picker/read cannot attach to a closed or replaced source and leaves no durable or scientific publication",async()=>{
 for(const change of ['closed','replacement','edited'] as const){
  const view=await openSource(`${change}.fchk`),owner=view.capture(),gate=deferred();
  const file=sidecar(),read=file.text.bind(file);let entered=false;
  file.text=async()=>{entered=true;await gate.promise;return read();};
  const pending=owner.prepare(file).then(()=>false,error=>error.name==='AbortError');
  await settle(()=>entered);
  if(change==='closed')await act(async()=>{await view.controller.api.closeDocuments([view.doc.id]);useMoleculeStore.getState().setDocuments([]);});
  else if(change==='replacement')useMoleculeStore.getState().setDocuments([{...view.doc}]);
  else await act(async()=>{await view.controller.api.beginEditing(view.doc);view.controller.api.updateDraft(view.doc,view.text+'\n',{previewApplied:true});});
  gate.resolve();expect(await pending).toBe(true);expect(await readBrowserScientificAttachment(view.doc.path)).toBeNull();
  expect(scientificStateFor(view.doc.id,view.text).companions).toBeUndefined();owner.release();await view.close();
 }
});

test("another browser-tab scope reopens Original without borrowing a companion; return to the first scope restores it",async()=>{
 const view=await openSource('scopes.fchk'),owner=view.capture();
 try{const prepared=await owner.prepare(sidecar());await act(async()=>prepared.apply(0));
  const scope=browser.sessionStorage.getItem('burette.browser-source-session')!;
  await view.controller.close();await view.page.close();releasePage();
  browser.sessionStorage.setItem('burette.browser-source-session',crypto.randomUUID());
  const other=await fixture();await act(async()=>other.api.openPaths([view.doc.path]));
  const otherDoc=useMoleculeStore.getState().documents.find(value=>value.path===view.doc.path)!,otherText=documents.readBrowserDevVirtualTextDocument(view.doc.path)!;
  expect(scientificStateFor(otherDoc.id,otherText).companions).toBeUndefined();expect(otherText).not.toBe(view.text);
  await other.close();releasePage();browser.sessionStorage.setItem('burette.browser-source-session',scope);
  const again=await fixture();await act(async()=>again.api.openPaths([view.doc.path]));
  try{const doc=useMoleculeStore.getState().documents.find(value=>value.path===view.doc.path)!;expect(scientificStateFor(doc.id,view.text).companions).toHaveLength(1);}finally{await again.close();}
 }finally{owner.release();await view.close();}
});

test("a prepared companion cannot publish after source replacement, and pending reopen cannot replace a later document",async()=>{
 const view=await openSource('late-admission.fchk'),old=view.capture();
 try{
  const prepared=await old.prepare(sidecar());
  useMoleculeStore.getState().setDocuments([{...view.doc}]);
  await expect(prepared.apply(0)).rejects.toMatchObject({name:'AbortError'});
  expect(await readBrowserScientificAttachment(view.doc.path)).toBeNull();
  useMoleculeStore.getState().setDocuments([view.doc]);
  const owner=view.capture();try{await act(async()=>{await(await owner.prepare(sidecar())).apply(0);});}finally{owner.release();}
  await view.controller.close();useMoleculeStore.getState().setDocuments([]);releaseClosedImports(new Set());documents.deleteBrowserDevVirtualTextDocument(view.doc.path);
  const gate=deferred();let staged:ViewerDocument|null=null;
  pauseAfterPrepare=async document=>{staged=document;await gate.promise;};
  const opening=view.page.api.openPaths([view.doc.path]);await settle(()=>staged!==null);
  const replacement={...view.doc,id:'replacement-owner'};useMoleculeStore.getState().setDocuments([replacement]);
  gate.resolve();await act(async()=>opening);pauseAfterPrepare=null;
  expect(useMoleculeStore.getState().documents).toEqual([replacement]);
  expect(scientificStateFor(replacement.id,view.text).revision).toBeNull();
  expect((await readBrowserScientificAttachment(view.doc.path))!.text).toBe(view.text);
 }finally{old.release();pauseAfterPrepare=null;await view.close();}
});

test("an explicitly selected compressed companion keeps its exact wrapper bytes through durable reopen",async()=>{
 const {gzipSync}=await import('node:zlib');
 const wrapper=new Uint8Array(gzipSync(Buffer.from(await sidecar().text())));
 const view=await openSource('compressed-companion.fchk'),owner=view.capture();
 try{
  const file=new File([wrapper],'selected.mcd.gz');
  await act(async()=>{await(await owner.prepare(file)).apply(0);});
  const saved=(await readBrowserScientificAttachment(view.doc.path))!;
  expect(saved.companions[0].name).toBe('selected.mcd.gz');
  expect(new Uint8Array(await saved.companions[0].file.arrayBuffer())).toEqual(wrapper);
  await view.controller.close();useMoleculeStore.getState().setDocuments([]);releaseClosedImports(new Set());documents.deleteBrowserDevVirtualTextDocument(view.doc.path);
  await act(async()=>view.page.api.openPaths([view.doc.path]));
  const doc=useMoleculeStore.getState().documents.find(value=>value.path===view.doc.path)!;
  expect(new Uint8Array(await scientificStateFor(doc.id,view.text).companions![0].file.arrayBuffer())).toEqual(wrapper);
  expect(await readBrowserSourceCheckpoint(doc.path)).toBeNull();
 }finally{owner.release();await view.close();}
});
