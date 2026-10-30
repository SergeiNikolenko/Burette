import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { IDBFactory, forceCloseDatabase } from "fake-indexeddb";
import { gzipSync } from "node:zlib";
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
const molden = readFileSync(new URL("./fixtures/quantum/dispatcher/hydrogen.molden", import.meta.url), "utf8");
function deferred<T = void>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
async function fixture() {
  const original = useMoleculeStore.getState().documents, ordinary: string[] = [], errors: unknown[] = [];
  let api!: ReturnType<typeof useAppFileOpen>;
  const store = useMoleculeStore.getState(), noop = () => {};
  const options: Parameters<typeof useAppFileOpen>[0] = { ...store, preferences: { ...defaultPreferences, rendererMode: "molstar" },
    addProjectRoot: noop, detectContentSpectrumPaths, expandStructureBundles: async paths => paths,
    openDockTab: noop, openDocumentTab: path => { ordinary.push(path); }, openFepNetworkTab: noop,
    pushErrorStatus: error => { errors.push(error); }, pushStatus: noop, rememberRecentStructures: noop,
    setDockActiveTab: noop, setDockDocument: noop, setDockOpen: noop,
  };
  function Probe() { api = useAppFileOpen(options); return null; }
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement); await act(async () => root.render(<Probe />));
  return { api, ordinary, errors, async close() {
    pauseAfterPrepare = null;
    for (const document of useMoleculeStore.getState().documents) if (!original.includes(document)) documents.deleteBrowserDevVirtualTextDocument(document.path);
    useMoleculeStore.getState().setDocuments(original); releaseClosedImports(new Set(original.map(document => document.id)));
    await act(async () => root.unmount()); host.remove();
  } };
}


const { spawn, execFileSync } = await import("node:child_process");
const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { createServer } = await import("node:net");
const { once } = await import("node:events");
const { browserDevFilesFromLocation } = await import("../apps/desktop/src/lib/browser-dev-startup");
const { readServerScientificFile } = await import("../apps/desktop/src/lib/workbench/server-scientific-file");
const workspace = await mkdtemp(join(tmpdir(), "scientific-startup-"));
const allowed = join(workspace,"allowed"), outside=join(workspace,"outside"), dist=join(workspace,"dist"), session=join(workspace,"session");
await Promise.all([allowed,outside,dist,session].map(path=>mkdir(path)));
await writeFile(join(dist,"index.html"),"<!doctype html><title>Isolated shell fixture</title>");
await writeFile(join(session,"session.json"),JSON.stringify({token:"scientific-startup-fixture",sessionDir:session}));
const raw = readFileSync(new URL("./fixtures/quantum/dispatcher/two-step-orca.out",import.meta.url));
const selected=join(allowed,"orca.out"), compressed=join(allowed,"orca.out.gz"), forbidden=join(outside,"private.out");
await Promise.all([writeFile(selected,raw),writeFile(compressed,gzipSync(raw)),writeFile(forbidden,raw)]);
const probe=createServer();probe.listen(0,"127.0.0.1");await once(probe,"listening");
const address=probe.address();if(!address || typeof address==="string")throw Error("Missing test port");
const port=address.port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
const child=spawn("node",["scripts/agent-shell-server.mjs","--dist",dist,"--session-dir",session,"--allow",allowed,"--host","127.0.0.1","--port",String(port)],{stdio:["ignore","pipe","pipe"]});
await new Promise<void>((resolve,reject)=>{let output="";child.stdout.on("data",chunk=>{output+=String(chunk);if(output.includes('"ok": true'))resolve();});child.once("error",reject);child.once("exit",code=>reject(Error(`Server exited ${code}`)));});
const base=`http://127.0.0.1:${port}`, originalFetch=globalThis.fetch;
const withFetchStatics = (handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch => Object.assign(handler, { preconnect: originalFetch.preconnect });
globalThis.fetch=withFetchStatics((input,init)=>originalFetch(new URL(String(input),base),{...init,headers:{...Object.fromEntries(new Headers(init?.headers)),Authorization:"Bearer scientific-startup-fixture"}}));
afterAll(async()=>{globalThis.fetch=originalFetch;child.kill();await once(child,"exit");execFileSync("/usr/bin/trash",[workspace]);});
const select=(path:string)=>browser.happyDOM.setURL(`${base}/?devFiles=${encodeURIComponent(path)}`);

test("CLI devFiles uses the scientific importer through the real authorized prebuilt server",async()=>{
 select(selected);const view=await fixture();
 try {
  expect(await browserDevFilesFromLocation()).toEqual([selected]);
  await view.api.openPaths(await browserDevFilesFromLocation(),{requireSuccess:true});
  const opened=useMoleculeStore.getState().documents.find(doc=>doc.path===selected)!;
  expect([opened.renderer,opened.extension,opened.virtual]).toEqual(["molstar","xyz",true]);
  const source=documents.readBrowserDevVirtualTextDocument(selected)!;
  expect(scientificStateFor(opened.id,source).revision?.document.format).toBe("orca");
  expect(new Uint8Array(await importedOriginalFor(opened.id)!.file.arrayBuffer())).toEqual(new Uint8Array(raw));
  expect(view.errors).toEqual([]);
 }finally{await view.close();}
});

test("server scientific imports retain compressed Original and refuse a forbidden path",async()=>{
 const view=await fixture();try {
  select(compressed);await view.api.openPaths([compressed],{requireSuccess:true});
  const opened=useMoleculeStore.getState().documents.find(doc=>doc.path===compressed)!;
  expect(importedOriginalFor(opened.id)!.name).toBe("orca.out.gz");
  expect(new Uint8Array(await importedOriginalFor(opened.id)!.file.arrayBuffer())).toEqual(new Uint8Array(gzipSync(raw)));
  select(forbidden);expect((await originalFetch(`${base}/@fs${forbidden}`,{headers:{Authorization:"Bearer scientific-startup-fixture"}})).status).toBe(403);
  await expect(readServerScientificFile(forbidden,()=>true)).rejects.toThrow("could not be read");
  expect(useMoleculeStore.getState().documents.some(doc=>doc.path===forbidden)).toBe(false);
 }finally{await view.close();}
});

test("a cancelled initial scientific selection never publishes over the next file",async()=>{
 select(selected);const view=await fixture(),entered=deferred<ViewerDocument>(),release=deferred();let current=true;
 pauseAfterPrepare=async document=>{entered.resolve(document);await release.promise;};
 try {
  const opening=view.api.openPaths([selected],{shouldApply:()=>current});await entered.promise;
  current=false;pauseAfterPrepare=null;select(compressed);await view.api.openPaths([compressed],{requireSuccess:true});
  release.resolve();await opening;
  expect(useMoleculeStore.getState().documents.filter(doc=>[selected,compressed].includes(doc.path)).map(doc=>doc.path)).toEqual([compressed]);
  expect(documents.readBrowserDevVirtualTextDocument(selected)).toBeNull();
 }finally{release.resolve();await view.close();}
});

test("stream bounds apply without trustworthy length and cancellation closes the body",async()=>{
 select(selected);const real=globalThis.fetch;
 try {
  for(const length of [undefined,"1"]){let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode("CARTESIAN COORDINATES (ANGSTROEM)\n"));c.enqueue(new Uint8Array(16*1024*1024));},cancel(){cancelled=true;}}),{headers:length?{"Content-Length":length}:undefined});
   globalThis.fetch=withFetchStatics(async()=>response);
   await expect(readServerScientificFile(selected,()=>true)).rejects.toThrow("16 MiB");expect(cancelled).toBe(true);
  }
  let current=true,cancelled=false;globalThis.fetch=withFetchStatics(async()=>new Response(new ReadableStream({pull(c){current=false;c.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}})));
  expect(await readServerScientificFile(selected,()=>current)).toBeNull();expect(cancelled).toBe(true);
  globalThis.fetch=withFetchStatics(async()=>new Response("ordinary log text",{headers:{"Content-Length":String(32*1024*1024)}}));
  expect(await readServerScientificFile(selected,()=>true)).toBeNull();
 }finally{globalThis.fetch=real;}
});

test("scientific startup never fetches an arbitrary URL or an unselected server path",async()=>{
 select(selected);const real=globalThis.fetch;let calls=0;
 globalThis.fetch=withFetchStatics(async()=>{calls++;throw Error("Unexpected request");});
 try {
  expect(await readServerScientificFile("https://example.invalid/source.out",()=>true)).toBeNull();
  expect(await readServerScientificFile(join(allowed,"unselected.out"),()=>true)).toBeNull();
  expect(await readServerScientificFile(selected,()=>false)).toBeNull();
  expect(calls).toBe(0);
 }finally{globalThis.fetch=real;}
});


test("independent: explicit traversal and symlink cannot escape server authorization", async () => {
  const { symlink } = await import("node:fs/promises");
  const link = join(allowed, "escape.out"); await symlink(forbidden, link);
  for (const path of [`${allowed}/../outside/private.out`, link]) {
    select(path);
    await expect(readServerScientificFile(path, () => true)).rejects.toThrow("could not be read");
  }
});

test("independent: encoded file names preserve BOM and CRLF Original through actual open", async () => {
  const name = join(allowed, "named # ? % unicode-α.molden");
  const bytes = new TextEncoder().encode("\ufeff" + molden.replace(/\r?\n/gu, "\r\n"));
  await writeFile(name, bytes); select(name); const view = await fixture();
  try {
    await view.api.openPaths([name], { requireSuccess: true });
    const document = useMoleculeStore.getState().documents.find(doc => doc.path === name)!;
    expect([document.extension, document.virtual]).toEqual(["xyz", true]);
    expect(new Uint8Array(await importedOriginalFor(document.id)!.file.arrayBuffer())).toEqual(bytes);
    expect(importedOriginalFor(document.id)!.name).toBe("named # ? % unicode-α.molden");
  } finally { await view.close(); }
});

test("independent: exact stream byte limit is inclusive and the next byte rejects", async () => {
  select(selected); const real = globalThis.fetch, limit = 16 * 1024 * 1024;
  try {
    for (const extra of [0, 1]) {
      const bytes = new Uint8Array(limit + extra); bytes.set(new TextEncoder().encode("CARTESIAN COORDINATES (ANGSTROEM)\n"));
      globalThis.fetch = withFetchStatics(async () => new Response(bytes));
      if (!extra) expect((await readServerScientificFile(selected, () => true))!.size).toBe(limit);
      else await expect(readServerScientificFile(selected, () => true)).rejects.toThrow("16 MiB");
    }
  } finally { globalThis.fetch = real; }
});

test("independent: cancellation during oversized prefix recognition must not report a stale failure", async () => {
  select(selected); const real = globalThis.fetch, text = Blob.prototype.text;
  let current = true, sniffed = false;
  const view = await fixture();
  try {
    const bytes = new Uint8Array(16 * 1024 * 1024 + 1);
    bytes.set(new TextEncoder().encode("CARTESIAN COORDINATES (ANGSTROEM)\n"));
    globalThis.fetch = withFetchStatics(async () => new Response(bytes));
    Blob.prototype.text = async function(this: Blob) {
      const result = await text.call(this);
      // The actual asynchronous prefix read completes after the selection was cancelled.
      sniffed = true; current = false; return result;
    };
    await expect(view.api.openPaths([selected], { shouldApply: () => current })).resolves.toBeUndefined();
    expect(sniffed).toBe(true);
    expect(useMoleculeStore.getState().documents.some(doc => doc.path === selected)).toBe(false);
  } finally { Blob.prototype.text = text; globalThis.fetch = real; await view.close(); }
});
