import { test, expect, React, act, createRoot, flush, water, doc, transport, ack, bindingFor, browser } from './geometry-foundation-fixture';
import type { ShellActions } from './geometry-foundation-fixture';
import type { ScientificDocument } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
import { parseXyz } from '../apps/desktop/src/lib/molecular-workbench/xyz';
import { afterAll } from 'bun:test';
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [name,value] of Object.entries({ HTMLSelectElement:browser.HTMLSelectElement, HTMLButtonElement:browser.HTMLButtonElement,
  SVGElement:browser.SVGElement, HTMLFormElement:browser.HTMLFormElement, DocumentFragment:browser.DocumentFragment, KeyboardEvent:browser.KeyboardEvent })) {
  previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name)); Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
}
afterAll(()=>{for(const [name,value] of previous){if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name);}});
const frames=new Map<number,FrameRequestCallback>();let serial=0;
for(const [name,value] of Object.entries({requestAnimationFrame:(callback:FrameRequestCallback)=>{frames.set(++serial,callback);return serial;},cancelAnimationFrame:(id:number)=>frames.delete(id)})){
 previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
}
// Browser callbacks have a microtask checkpoint between each animation-frame callback.
const step=async()=>{const batch=[...frames.entries()];for(const [id,callback] of batch){if(!frames.delete(id))continue;await act(async()=>callback(performance.now()+250));}};
const {VibrationsDockContent}=await import('../apps/desktop/src/components/workbench/vibrations-dock-content');
const {adoptLogicalSource,releaseClosedScienceSessions}=await import('../apps/desktop/src/lib/science-session/state');
const {addDocumentInternalCoordinates,releaseClosedImports}=await import('../apps/desktop/src/lib/workbench/scientific-source-state');


test('lazy owner follows exact scientific revisions and retires the whole panel on close',async()=>{
 const current=doc(), binding=bindingFor(current), atoms=parseXyz(water).atoms;
 const science:ScientificDocument={format:'xyz',atoms,frames:[{atoms}],orbitals:[],modes:[{index:6,frequencyCm1:1600,intensityKmMol:70}]};
 adoptLogicalSource({documentId:current.id,extension:'xyz',text:water},'science-restore',null,[]);
 addDocumentInternalCoordinates(current.id,water,science);
 const send:ShellActions['runStructureViewerAction']=async()=>({lease:binding.lease,text:water});
 const actions={runStructureViewerAction:send} as ShellActions;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>{root.render(<VibrationsDockContent document={current} actions={actions}/>);});
  await act(async()=>{});
  expect(host.querySelector('table[aria-label="Vibrational modes"] tbody')?.textContent).toContain('1600.0');
  await act(async()=>addDocumentInternalCoordinates(current.id,water,{...science,modes:[{index:9,frequencyCm1:2000,intensityKmMol:20}]}));
  expect(host.querySelector('table tbody')?.textContent).toContain('2000.0');
  expect(host.querySelector('table tbody')?.textContent).not.toContain('1600.0');
  expect(host.querySelector('tr[aria-selected="true"]')).toBeNull();
  await act(async()=>root.render(<VibrationsDockContent document={null} actions={actions}/>));
  expect(host.querySelector('table')).toBeNull();
 }finally{await act(async()=>root.unmount());host.remove();releaseClosedImports(new Set());releaseClosedScienceSessions(new Set());}
});

test('external renderer retains modes and export without private Geometry requests; MolStar binds live',async()=>{
 const current=doc(), external={...current,renderer:'xyzrender-external' as const}, atoms=parseXyz(water).atoms;
 const science:ScientificDocument={format:'xyz',atoms,frames:[{atoms}],orbitals:[],modes:[{index:6,frequencyCm1:1600,intensityKmMol:70,displacements:atoms.map(()=>[.1,0,0])}]};
 adoptLogicalSource({documentId:current.id,extension:'xyz',text:water},'science-restore',null,[]);addDocumentInternalCoordinates(current.id,water,science);
 const calls:string[]=[], saved:string[]=[];
 const send:ShellActions['runStructureViewerAction']=async(_document,action)=>{calls.push(action.type);return {lease:'molstar-live',text:water};};
 const save:ShellActions['saveKetcherExportFile']=async request=>{saved.push(request.text);return {status:'saved',path:null};};
 const actions={runStructureViewerAction:send,saveKetcherExportFile:save} as ShellActions;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<VibrationsDockContent document={external} actions={actions}/>));await act(async()=>{});
  expect(host.querySelector('table tbody')?.textContent).toContain('1600.0');expect(calls).toEqual([]);
  expect([...host.querySelectorAll('button')].some(node=>node.textContent==='Animate')).toBe(false);
  const button=[...host.querySelectorAll('button')].find(node=>node.textContent==='Export')!;
  await act(async()=>button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  const json=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node=>node.textContent==='Spectrum as JSON')!;
  await act(async()=>json.click());expect(JSON.parse(saved[0]).modes[0].frequencyCm1).toBe(1600);expect(calls).toEqual([]);
  bindingFor(current);
  await act(async()=>root.render(<VibrationsDockContent document={current} actions={actions}/>));await act(async()=>{});
  expect(calls).toEqual(['geometry_binding']);expect([...host.querySelectorAll('button')].find(node=>node.textContent==='Animate')?.disabled).toBe(false);
 }finally{await act(async()=>root.unmount());host.remove();releaseClosedImports(new Set());releaseClosedScienceSessions(new Set());}
});
