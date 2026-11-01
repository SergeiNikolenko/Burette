import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { IDBFactory } from "fake-indexeddb";
const browser=new Window({url:"http://localhost/"}),factory=new IDBFactory(),prior=new Map<string,PropertyDescriptor|undefined>();
for(const[key,value]of Object.entries({window:browser,indexedDB:factory})){prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});}
afterAll(async()=>{await browser.happyDOM.close();for(const[key,value]of prior){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
browser.sessionStorage.setItem("burette.browser-source-session","migration-scope");
const file=new Blob(["Original before schema upgrade\r\n"]),path="/OpenedFiles/upgrade.xyz";
const originalSha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer())),v=>v.toString(16).padStart(2,"0")).join("");
const checkpoint={version:1 as const,scope:"migration-scope",path,id:"old-checkpoint",revision:1,originalSha256,originalName:"upgrade.xyz",originalBytes:file.size,baseText:"base",text:"draft",science:null};
await new Promise<void>((resolve,reject)=>{const open=factory.open("burette-browser-imports",2);open.onupgradeneeded=()=>{open.result.createObjectStore("files",{keyPath:"path"});open.result.createObjectStore("source-checkpoints",{keyPath:["scope","path"]});};open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(["files","source-checkpoints"],"readwrite");tx.objectStore("files").put({path,name:"upgrade.xyz",kind:"text",file});tx.objectStore("source-checkpoints").put(checkpoint);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
const {openBrowserImportDatabase,readBrowserImport}=await import("../apps/desktop/src/lib/browser-import-storage");
const {readBrowserSourceCheckpoint,writeBrowserSourceCheckpoint}=await import("../apps/desktop/src/lib/browser-source-checkpoint");
const {readBrowserSourceRecord}=await import("../apps/desktop/src/lib/browser-source-storage");
test("version 2 originals and dirty checkpoints survive additive clean-attachment upgrade and remain writable",async()=>{
 const db=await openBrowserImportDatabase();expect(db.version).toBe(3);
 expect(new Uint8Array(await (await readBrowserImport(path))!.file.arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
 expect(await readBrowserSourceCheckpoint(path)).toEqual(checkpoint);
 expect(await readBrowserSourceRecord("scientific-attachments",path)).toBeNull();
 const next={...checkpoint,id:"after-upgrade",revision:2,text:"next draft"};
 expect(await writeBrowserSourceCheckpoint(checkpoint,checkpoint.id,next,()=>true)).toBe(true);
 expect(await readBrowserSourceCheckpoint(path)).toEqual(next);
});
