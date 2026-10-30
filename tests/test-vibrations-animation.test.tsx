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
const {VibrationsPanel}=await import('../apps/desktop/src/components/workbench/vibrations-panel');

test('full panel animation waits for its real binding and rolls back after a held preview ACK',async()=>{
  const documentValue=doc(), binding=bindingFor(documentValue), t=transport(), atoms=parseXyz(water).atoms;
  const science:ScientificDocument={format:'xyz',atoms,frames:[{atoms}],orbitals:[],modes:[{index:6,frequencyCm1:1600,intensityKmMol:70,displacements:atoms.map(()=>[.1,0,0])}]};
  const before=JSON.stringify(science);
  const send:ShellActions['runStructureViewerAction']=(document,action,options)=>action.type==='geometry_binding'?Promise.resolve({lease:binding.lease,text:water}):t.send(document,action,options);
  // Only the viewer transport is supplied; this scenario never invokes file/dialog actions.
  const actions={runStructureViewerAction:send} as ShellActions;
  const host=globalThis.document.createElement('div');globalThis.document.body.append(host);const root=createRoot(host);
  const button=(name:string)=>[...host.querySelectorAll('button')].find(node=>node.textContent===name)!;
  try {
    await act(async()=>root.render(<VibrationsPanel document={documentValue} science={science} liveAnimation actions={actions}/>));
    expect(button('Animate').disabled).toBe(false);
    await act(async()=>button('Animate').click()); await step(); await step();
    expect(t.calls.length).toBe(1);expect(t.calls[0].text).not.toBe(water);
    await act(async()=>button('Stop').click());expect(t.calls).toHaveLength(1);
    await ack(t.calls[0]);expect(t.calls).toHaveLength(2);expect(t.calls[1].text).toBe(water);
    await ack(t.calls[1]);expect(JSON.stringify(science)).toBe(before);
    expect(button('Animate').disabled).toBe(false);
  }finally{for(const call of t.calls)await ack(call);await act(async()=>root.unmount());host.remove();}
});
