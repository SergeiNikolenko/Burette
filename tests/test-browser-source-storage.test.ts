import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
import type { BrowserSourceCheckpoint } from "../apps/desktop/src/lib/browser-source-checkpoint";
const browser = new Window({ url: "http://localhost/" }), descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, indexedDB: new IDBFactory() })) {
  descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true });
}
afterAll(async () => { await browser.happyDOM.close(); for (const [key, descriptor] of descriptors) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
} });
const { saveBrowserImport, openBrowserImportDatabase } = await import("../apps/desktop/src/lib/browser-import-storage");
const { browserCheckpointOriginal, writeBrowserSourceCheckpoint, readBrowserSourceCheckpoint } = await import("../apps/desktop/src/lib/browser-source-checkpoint");
const { sha256Hex } = await import("../apps/desktop/src/lib/source-editing/source-identity");
const { parseScientificFile } = await import("../apps/desktop/src/lib/molecular-workbench/quantum");
const { serializeXyz } = await import("../apps/desktop/src/lib/molecular-workbench/xyz");
async function fixture(name: string, file = new Blob(["10000 -2.25 .12\r\n"])) {
  const path = `/OpenedFiles/${name}.out`, primary = new File(["primary original\r\n"], `${name}.out`);
  await saveBrowserImport({ path, name: primary.name, kind: "text", file: primary });
  const original = (await browserCheckpointOriginal(path))!, science = parseScientificFile("water.xyz", "3\nwater\nO 0 0 0\nH 1 0 0\nH 0 1 0\n");
  const text = serializeXyz(science.atoms, "source geometry");
  const hashes = { primaryOriginalSha256: original.originalSha256, companionOriginalSha256: await sha256Hex(new Uint8Array(await file.arrayBuffer())), sourceRevisionSha256: await sha256Hex(text) };
  science.frames[0].mcdCompanion = { ...hashes, spectra: { kind: "scientific-spectra", version: 1,
    source: { name: "explicit.mcd", format: "orca-mcd", scope: "frame", frameIndex: 0, frameCount: 1 }, atomicNumbers: [8, 1, 1],
    spectra: [{ kind: "mcd", xUnit: "cm^-1", positions: [10000], values: [-2.25], valueUnit: null, auxiliary: [{ name: "absorption", unit: null, values: [.12] }] }] } };
  const checkpoint: BrowserSourceCheckpoint = { ...original, version: 2, id: `${name}:1`, revision: 1, baseText: text, text, science,
    companions: [{ role: "orca-mcd", frameIndex: 0, frameCount: 1, name: "explicit.mcd", file, ...hashes }] };
  return { original, checkpoint, path };
}
async function clear() {
  const db = await openBrowserImportDatabase();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("source-checkpoints", "readwrite"); tx.objectStore("source-checkpoints").clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}


const { readBrowserSourceRecord, writeBrowserSourceRecord } = await import("../apps/desktop/src/lib/browser-source-storage");
test("clean attachments and dirty checkpoints share one atomic 32 MiB aggregate budget",async()=>{
 const padding=new Blob(["10000 -2.25 .12\r\n",new Uint8Array(11*1024*1024)]);
 const a=await fixture('shared-budget-a',padding),b=await fixture('shared-budget-b',padding);
 const clean={kind:'scientific-attachment' as const,version:1 as const,...a.original,id:'clean-a',title:'a.xyz',text:a.checkpoint.text,science:a.checkpoint.science!,companions:a.checkpoint.companions!};
 expect(await writeBrowserSourceRecord('scientific-attachments',a.original,null,clean,()=>true)).toBe(true);
 expect(await writeBrowserSourceCheckpoint(a.original,null,a.checkpoint,()=>true)).toBe(true);
 const next={...clean,...b.original,id:'clean-b',text:b.checkpoint.text,science:b.checkpoint.science!,companions:b.checkpoint.companions!};
 await expect(writeBrowserSourceRecord('scientific-attachments',b.original,null,next,()=>true)).rejects.toThrow('full');
 expect(await readBrowserSourceRecord('scientific-attachments',b.path)).toBeNull();
 expect((await readBrowserSourceRecord('scientific-attachments',a.path))!.id).toBe('clean-a');
 expect((await readBrowserSourceCheckpoint(a.path))!.id).toBe(a.checkpoint.id);
});

test("a cancelled clean writer and a stale CAS cannot replace or delete a newer attachment",async()=>{
 await clear();const {original,checkpoint,path}=await fixture('attachment-cas');
 const clean={kind:'scientific-attachment' as const,version:1 as const,...original,id:'clean-initial',title:'source.xyz',text:checkpoint.text,science:checkpoint.science!,companions:checkpoint.companions!};
 expect(await writeBrowserSourceRecord('scientific-attachments',original,null,clean,()=>true)).toBe(true);
 const a={...clean,id:'a'},b={...clean,id:'b'};
 const results=await Promise.all([writeBrowserSourceRecord('scientific-attachments',original,clean.id,a,()=>true),writeBrowserSourceRecord('scientific-attachments',original,clean.id,b,()=>true)]);
 expect(results.filter(Boolean)).toHaveLength(1);
 expect(await writeBrowserSourceRecord('scientific-attachments',original,clean.id,null,()=>true)).toBe(false);
 expect(await writeBrowserSourceRecord('scientific-attachments',original,results[0]?'a':'b',{...clean,id:'retired'},()=>false)).toBe(false);
 expect((await readBrowserSourceRecord('scientific-attachments',path))!.id).toBe(results[0]?'a':'b');
});
