import { test, expect, React, act, createRoot, useGeometryLivePreview, flush, water, doc, browser } from './geometry-foundation-fixture';
import type { ViewerDocument, ShellActions } from './geometry-foundation-fixture';
import type { StructureViewerAction } from '../apps/desktop/src/components/types';
import type { GeometryBinding } from '../apps/desktop/src/lib/geometry-binding';
const { readGeometryBinding } = await import('../apps/desktop/src/lib/geometry-binding');
const { useAppMolstarActionSenders } = await import('../apps/desktop/src/hooks/use-app-molstar-action-senders');
const { activeViewerIframeForDocument } = await import('../apps/desktop/src/lib/viewer-bridge');
type Wire = { source: string; body: { id: string; action: StructureViewerAction } };
let serial = 0;
function scene(documentId: string) {
 const frame = document.createElement('iframe'); frame.className='viewer-iframe'; frame.dataset.documentId=documentId; frame.dataset.renderer='molstar'; document.body.append(frame);
 const source=frame.contentWindow!, lease=`reader-captured-${++serial}`, updates: Wire[]=[], reads: Wire[]=[];
 const replyNow=(request:Wire,result:Record<string,unknown>)=>browser.dispatchEvent(new browser.MessageEvent('message',{source:source as unknown as typeof browser,data:{source:'burette-agent-viewer',body:{type:'agent-action-result',id:request.body.id,result}}}));
 Object.defineProperty(source,'postMessage',{configurable:true,value:(request:Wire)=>{
  if(request.body.action.type==='geometry_binding') {reads.push(request);queueMicrotask(()=>replyNow(request,{ok:true,result:{lease,text:water}}));}
  else if(request.body.action.type==='update_geometry')updates.push(request);
  else throw Error('Unexpected action');
 }});
 return {frame,source,lease,updates,reads,reply:async(request:Wire,result:Record<string,unknown>={ok:true,result:{}})=>act(async()=>{replyNow(request,result);})};
}
async function surface(initial:ViewerDocument) {
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const errors:{documentId:string;error:string}[]=[];let api!:ReturnType<typeof useGeometryLivePreview>;let send!:ShellActions['runStructureViewerAction'];
 function Probe({current,binding}:{current:ViewerDocument;binding:GeometryBinding|null}) {
  const actions=useAppMolstarActionSenders({activeDocument:current,documents:[current],activeViewerIframeForDocument,pushStatus:()=>{}});send=actions.runStructureViewerAction;
  api=useGeometryLivePreview(current,binding,send,error=>errors.push({documentId:current.id,error:String(error)}));return null;
 }
 const render=async(current:ViewerDocument,binding:GeometryBinding|null)=>act(async()=>root.render(<Probe current={current} binding={binding}/>));
 await render(initial,null);
 const read=async(current:ViewerDocument)=>{let binding!:GeometryBinding;await act(async()=>{binding=await readGeometryBinding(current,send,()=>true);});return binding;};
 return {api:()=>api,errors,render,read,close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
test('independent reader replay: old document failure never reaches the next document handler',async()=>{
 const old=doc(),next=doc(),a=scene(old.id),b=scene(next.id),ui=await surface(old);
 try{
  const binding=await ui.read(old);expect(binding.lease).toBe(a.lease);expect(a.reads).toHaveLength(1);await ui.render(old,binding);
  ui.api().preview(water.replace('0.957200000123','1.1'),water);await flush();expect(a.updates).toHaveLength(1);
  const nextBinding=await ui.read(next);await ui.render(next,nextBinding);await a.reply(a.updates[0],{ok:false,error:{message:'old-viewer-failure'}});
  expect(ui.errors.filter(error=>error.documentId===next.id)).toEqual([]);
  expect(b.updates).toHaveLength(0);
  if(a.updates[1])await a.reply(a.updates[1]);
 }finally{await ui.close();a.frame.remove();b.frame.remove();}
});
test('independent reader replay: queued old rollback retains the original target and opaque lease',async()=>{
 const old=doc(),next={...old,path:'/replacement.xyz',title:'replacement.xyz'},a=scene(old.id),ui=await surface(old);let b:ReturnType<typeof scene>|null=null;
 try{
  const binding=await ui.read(old);await ui.render(old,binding);ui.api().preview(water.replace('0.957200000123','1.1'),water);await flush();
  expect(a.updates).toHaveLength(1);expect(a.updates[0].body.action.type==='update_geometry'&&a.updates[0].body.action.lease).toBe(a.lease);
  a.frame.remove();b=scene(old.id);const fresh=await ui.read(next);expect(fresh.lease).toBe(b.lease);await ui.render(next,fresh);await a.reply(a.updates[0]);
  expect(b.updates).toHaveLength(0);
 }finally{await ui.close();a.frame.remove();b?.frame.remove();}
});
test('independent: topology callback cannot run after its captured frame becomes stale while rollback is queued',async()=>{
 const d=doc(),a=scene(d.id),ui=await surface(d);let b:ReturnType<typeof scene>|null=null;let reloaded=false;
 try{
  const binding=await ui.read(d);await ui.render(d,binding);ui.api().preview(water.replace('0.957200000123','1.1'),water);await flush();
  const replacing=ui.api().replace(async()=>{reloaded=true;return 'reloaded';}).catch(error=>String(error));
  a.frame.remove();b=scene(d.id);await a.reply(a.updates[0]);await replacing;
  expect(b.updates).toHaveLength(0);expect(reloaded).toBe(false);
 }finally{await ui.close();a.frame.remove();b?.frame.remove();}
});
test('replacement rejects a failed owner barrier and a current owner can retry after an earlier failure', async () => {
 const d=doc(),a=scene(d.id),ui=await surface(d);let reloaded=0;
 try {
  const binding=await ui.read(d);await ui.render(d,binding);
  const first=ui.api().replace(async()=>++reloaded).catch(error=>String(error));
  await act(async()=>{});expect(a.updates).toHaveLength(1);
  await a.reply(a.updates[0],{ok:false,error:{message:'owner changed'}});await first;
  expect(reloaded).toBe(0);
  const retry=ui.api().replace(async()=>++reloaded);
  await act(async()=>{});expect(a.updates).toHaveLength(2);
  expect(a.updates[1].body.action).toMatchObject({type:'update_geometry',lease:binding.lease,text:binding.text});
  await a.reply(a.updates[1]);expect(await retry).toBe(1);
 } finally {await ui.close();a.frame.remove();}
});
