import { afterAll, expect, mock, test } from 'bun:test';
import { plugin } from 'bun';
import { transformSync } from '@babel/core';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import type { ViewerDocument } from '../apps/desktop/src/types';
import type { ShellActions, ShellViewState } from '../apps/desktop/src/components/types';
const compiled = new Map<string, boolean>();
plugin({ name: 'scientific-header-compiler', setup(build) {
 build.onLoad({ filter: /(?:open-in-editor-menu|workspace-file-header|browser-structure-download)\.tsx$|scientific-source-state\.ts$/u }, ({ path }) => {
  const code=transformSync(readFileSync(path,'utf8'),{filename:path,babelrc:false,configFile:false,parserOpts:{plugins:['typescript','jsx']},plugins:[['babel-plugin-react-compiler',{}]]})!.code!;
  compiled.set(path.split('/').at(-1)!,code.includes('react/compiler-runtime')); return {contents:code,loader:'tsx'};
 });
} });
const browser=new Window({url:'http://localhost/'}), previous=new Map<string,PropertyDescriptor|undefined>();
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLButtonElement','HTMLIFrameElement','Element','Node','NodeFilter','DocumentFragment','SVGElement','Event','MouseEvent','MutationObserver','ResizeObserver','getComputedStyle','DOMRect','CustomEvent','KeyboardEvent','PointerEvent','FocusEvent','requestAnimationFrame','cancelAnimationFrame','localStorage','CSS'] as const){
 previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='window'?browser:browser[key]});
}
previous.set('IS_REACT_ACT_ENVIRONMENT',Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT'));Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
afterAll(async()=>{await new Promise(resolve=>setTimeout(resolve,10));await browser.happyDOM.close();for(const[key,value]of previous){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}});
let native=false;const tauri=await import('../apps/desktop/src/lib/tauri');mock.module('../apps/desktop/src/lib/tauri',()=>({...tauri,isTauriRuntime:()=>native}));
const core=await import('@tauri-apps/api/core');mock.module('@tauri-apps/api/core',()=>({...core,invoke:async()=>null}));
const {createRoot}=await import('react-dom/client');
const {OpenInEditorMenu}=await import('../apps/desktop/src/components/open-in-editor-menu');
const {openScientificFiles}=await import('../apps/desktop/src/lib/workbench/open');
const {openBrowserDevTextDocument,writeBrowserDevVirtualTextDocument,deleteBrowserDevVirtualTextDocument}=await import('../apps/desktop/src/lib/browser-dev-documents');
const {useMoleculeStore}=await import('../apps/desktop/src/stores/molecule-store');
const {releaseClosedImports}=await import('../apps/desktop/src/lib/workbench/scientific-source-state');
const {SourceEditingProvider}=await import('../apps/desktop/src/lib/source-editing/context');
const {defaultPreferences}=await import('../apps/desktop/src/stores/settings-store');
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/quantum/dispatcher/${name}`,import.meta.url),'utf8');
async function mount(){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const prior=useMoleculeStore.getState().documents;
 let current:ViewerDocument|null=null,draft:string|undefined;const calls:string[]=[],beforeClaim:boolean[]=[];
 const actions={listChemicalEditorTargets:async()=>[],copyPath:async()=>{calls.push('copy');},toggleDock:()=>calls.push('dock'),openPathWithDefaultApp:async()=>{calls.push('open');}} as unknown as ShellActions;
 const render=async(document:ViewerDocument|null=current,presentation:'chrome'|'file-header'='file-header')=>{current=document;await act(async()=>root.render(<SourceEditingProvider value={{sessionForDocument:()=>draft===undefined?null:{content:draft}} as never}><OpenInEditorMenu state={{activeDocument:document,activeTab:null,textDocuments:[],sidebarProjects:[],preferences:{...defaultPreferences,openInDefaultDestination:"default-app"},rightDockOpen:false} as unknown as ShellViewState} actions={actions} presentation={presentation} navigation={()=> <button>Back</button>} /></SourceEditingProvider>));};
 const imported={openStructureRecords:async(records:Parameters<ShellActions['openStructureRecords']>[0])=>{
  const docs=await Promise.all(records.map(record=>openBrowserDevTextDocument(record.path,record.inputExtension,record.text,defaultPreferences)));
  useMoleculeStore.getState().addDocuments(docs);await render(docs[0]);beforeClaim.push(Boolean(host.querySelector('[aria-label="Download file"]')));return docs;
 }};
 return {host,calls,beforeClaim,render,imported,current:()=>current,edit:async(text:string)=>{draft=text;if(current)writeBrowserDevVirtualTextDocument(current.path,text);await render();},close:async()=>{native=false;await act(async()=>root.unmount());host.remove();for(const d of useMoleculeStore.getState().documents)if(!prior.includes(d))deleteBrowserDevVirtualTextDocument(d.path);useMoleculeStore.getState().setDocuments(prior);releaseClosedImports(new Set(prior.map(d=>d.id)));}};
}
async function menu(){await act(async()=>document.querySelector('[aria-label="Download file"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));}
async function choose(prefix:string){await act(async()=>{[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item=>item.textContent?.startsWith(prefix))!.click();});}
for(const name of ['hydrogen.molden','two-step-orca.out','hydrogen.molden.gz'])test(`compiled real header downloads exact ${name} Original after source edit and reopens it`,async()=>{
 const f=await mount(),input=name.endsWith('.gz')?name.slice(0,-3):name,raw='\ufeff'+fixture(input).replace(/\n/g,'\r\n');const file=new File([name.endsWith('.gz')?gzipSync(raw):raw],name);
 const blobs:Blob[]=[],old=URL.createObjectURL;URL.createObjectURL=blob=>{if(!(blob instanceof Blob))throw new Error("Expected file Blob");blobs.push(blob);return 'blob:header-proof';};
 try{
  await act(async()=>openScientificFiles(f.imported,[file]));expect(f.beforeClaim[0]).toBe(false);expect(f.host.querySelector('header[aria-label="Current file"]')).not.toBeNull();expect(f.host.textContent).toContain('Back');expect(f.host.querySelector('[aria-label="Toggle right panel"]')).not.toBeNull();
  await menu();expect([...document.querySelectorAll('[role="menuitem"]')].map(item=>item.textContent)).toEqual([`Geometry · ${f.current()!.title}`,`Original · ${name}`]);await choose('Original');
  expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
  const edited='1\nedited geometry\nH .25 0 0\n';await f.edit(edited);await menu();await choose('Geometry');expect(await blobs[1].text()).toBe(edited);
  await menu();await choose('Original');expect(new Uint8Array(await blobs[2].arrayBuffer())).toEqual(new Uint8Array(await file.arrayBuffer()));
  const priorId=f.current()!.id;await act(async()=>openScientificFiles(f.imported,[new File([blobs[2]],name)]));expect(f.current()!.id).not.toBe(priorId);expect(f.current()!.extension).toBe('xyz');
  await f.render(f.current(),'chrome');expect(f.host.querySelector('[aria-label="Download file"]')).not.toBeNull();
  await act(async()=>releaseClosedImports(new Set()));expect(f.host.querySelector('[aria-label="Download file"]')).toBeNull();
 }finally{URL.createObjectURL=old;await f.close();}
});
test('ordinary file header retains Open/copy/dock controls and native mode does not mount the browser Original button',async()=>{
 const f=await mount();try{
  await f.render({id:'ordinary',path:'/project/ordinary.pdb',title:'ordinary.pdb',extension:'pdb',renderer:'molstar',runtimePath:'',byteCount:0});
  expect(f.host.querySelector('[aria-label="Download file"]')).toBeNull();
  await act(async()=>{for(const label of ['Copy file path','Toggle right panel','Open with Default App'])f.host.querySelector<HTMLElement>(`[aria-label="${label}"]`)!.click();});expect(f.calls).toEqual(['copy','dock','open']);
  await act(async()=>openScientificFiles(f.imported,[new File([fixture('hydrogen.molden')],'native.molden')]));native=true;await f.render();expect(f.host.querySelector('[aria-label="Download file"]')).toBeNull();
  expect(compiled.get('browser-structure-download.tsx')).toBe(true);expect(compiled.get('scientific-source-state.ts')).toBe(true);
 }finally{await f.close();}
});
test('existing compressed source keeps Text, Compressed and Original header actions',async()=>{
 const {registerCompressedSource}=await import('../apps/desktop/src/lib/compressed-files/sources');
 const {supportedCompressedName}=await import('../apps/desktop/src/lib/compressed-files/formats');
 const f=await mount(),path='/OpenedFiles/legacy.xyz.gz',xyz='1\nlegacy\nHe 0 0 0\n',raw=gzipSync(xyz),file=new Blob([raw]);
 const blobs:Blob[]=[],old=URL.createObjectURL;URL.createObjectURL=blob=>{if(!(blob instanceof Blob))throw new Error("Expected file Blob");blobs.push(blob);return 'blob:legacy-proof';};
 try{
  registerCompressedSource(path,'legacy.xyz.gz',file,supportedCompressedName('legacy.xyz.gz'));writeBrowserDevVirtualTextDocument(path,xyz);
  await f.render({id:'legacy-compressed',path,title:'legacy.xyz',extension:'xyz',renderer:'molstar',runtimePath:'',byteCount:xyz.length,virtual:true});
  await menu();expect([...document.querySelectorAll('[role="menuitem"]')].map(item=>item.textContent)).toEqual(['Text · legacy.xyz','Compressed · legacy.xyz.gz','Original · legacy.xyz.gz']);
  await choose('Original');expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(new Uint8Array(raw));
 }finally{URL.createObjectURL=old;deleteBrowserDevVirtualTextDocument(path);await f.close();}
});

afterAll(()=>console.log(JSON.stringify({compilerCacheEmitted:Object.fromEntries(compiled)})));
