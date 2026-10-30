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
test('independent compiled lifetime: changing documents with the retained read binding retires the old error callback',async()=>{
 const old=doc(),next=doc(),a=scene(old.id),b=scene(next.id),ui=await surface(old);
 try {
  const binding=await ui.read(old);await ui.render(old,binding);
  ui.api().preview(water.replace('0.957200000123','1.1'),water);await flush();
  expect(a.updates).toHaveLength(1);
  await ui.render(next,binding);
  await a.reply(a.updates[0],{ok:false,error:{message:'old-viewer-failure'}});
  expect(ui.errors.filter(error=>error.documentId===next.id)).toEqual([]);
 } finally {
  await ui.close();
  if(a.updates[1])await a.reply(a.updates[1]);
  a.frame.remove();b.frame.remove();
 }
});
