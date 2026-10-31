import { test, expect, React, act, createRoot, browser } from './geometry-foundation-fixture';
import { afterAll } from 'bun:test';
import { plugin as installPlugin } from 'bun';
import { transformSync } from '@babel/core';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { molstarStatePreconditionPlugin } from '../scripts/molstar-state-precondition.mjs';
import type { ShellActions } from '../apps/desktop/src/components/types';
import type { ScientificDocument } from '../apps/desktop/src/lib/molecular-workbench/scientific-types';
import type { ViewerDocument } from '../apps/desktop/src/types';
installPlugin(molstarStatePreconditionPlugin);
Object.assign(browser,{setImmediate,clearImmediate});
export const compiler: boolean[] = [];
installPlugin({name:'orbitals-standard-compiler',setup(build){build.onLoad({filter:/orbitals-panel\.tsx$/u},({path})=>{let compiled=false;const result=transformSync(readFileSync(path,'utf8'),{filename:path,babelrc:false,configFile:false,parserOpts:{plugins:['typescript','jsx']},plugins:[['babel-plugin-react-compiler',{logger:{logEvent:(_file:string,event:{kind:string})=>{if(event.kind==='CompileSuccess')compiled=true;}}}]]});compiler.push(compiled);return {contents:result!.code!,loader:'tsx'};});}});
const previous=new Map<string,PropertyDescriptor|undefined>();
for(const [name,value] of Object.entries({ResizeObserver:browser.ResizeObserver,HTMLFormElement:browser.HTMLFormElement,HTMLInputElement:browser.HTMLInputElement,HTMLIFrameElement:browser.HTMLIFrameElement,HTMLSelectElement:browser.HTMLSelectElement,HTMLButtonElement:browser.HTMLButtonElement,SVGElement:browser.SVGElement,DocumentFragment:browser.DocumentFragment,KeyboardEvent:browser.KeyboardEvent,MessageEvent:browser.MessageEvent})){
 previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
}
const NativeWorker=Worker, workers:ObservedWorker[]=[];let holdNext=false, releaseHeld:(()=>void)|null=null;
class ObservedWorker extends NativeWorker {
 constructor(url:string|URL,options?:WorkerOptions){super(url,options);workers.push(this);if(options?.name==='burette-quantum-field')super.addEventListener('message',event=>{if(holdNext){holdNext=false;event.stopImmediatePropagation();releaseHeld=()=>this.dispatchEvent(event);}});}
}
previous.set('Worker',Object.getOwnPropertyDescriptor(globalThis,'Worker'));Object.defineProperty(globalThis,'Worker',{configurable:true,value:ObservedWorker});
afterAll(()=>{console.log('Orbitals standard compiler cache:',JSON.stringify(compiler));for(const worker of workers)worker.terminate();for(const[name,value]of previous){if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name);}});
export const holdQuantum=()=>{holdNext=true;releaseHeld=null;};
export const releaseQuantum=()=>{const callback=releaseHeld;releaseHeld=null;callback?.();};
export const quantumHeld=()=>Boolean(releaseHeld);
const {PluginContext}=await import('molstar/lib/mol-plugin/context.js');
const {StateTransforms}=await import('molstar/lib/mol-plugin-state/transforms.js');
const {useAppMolstarActionSenders}=await import('../apps/desktop/src/hooks/use-app-molstar-action-senders');
const {activeViewerIframeForDocument}=await import('../apps/desktop/src/lib/viewer-bridge');
const {OrbitalsDockContent}=await import('../apps/desktop/src/components/workbench/orbitals-dock-content');
const {adoptLogicalSource,releaseClosedScienceSessions}=await import('../apps/desktop/src/lib/science-session/state');
const {addDocumentInternalCoordinates,releaseClosedImports}=await import('../apps/desktop/src/lib/workbench/scientific-source-state');
const {runReaderTask}=await import('../apps/desktop/src/lib/workbench/reader-task');
export {test,expect,React,act};
export const wait=async(check:()=>boolean,label:string)=>{for(let i=0;i<100&&!check();i++)await act(async()=>new Promise(r=>setTimeout(r,10)));if(!check())throw new Error(`Timed out: ${label}`);};
export async function fixture(volumeOnly: boolean|string=false){
 let science=await runReaderTask({action:'parse',name:'h.molden',text:readFileSync(new URL('fixtures/quantum/dispatcher/hydrogen.molden',import.meta.url),'utf8')});
 science.orbitals[0].occupancy=.25;science.orbitals[1].occupancy=.75;
 science.orbitals.push({...science.orbitals[0],index:2,occupancy:0,energyHartree:.5},{...science.orbitals[1],index:3,occupancy:0,energyHartree:.6});
 science.grid={dimensions:[2,2,2],origin:[0,0,0],axes:[[.5,.1,0],[0,.5,.1],[.1,0,.5]],values:new Float32Array([-1,0,1,2,-2,0,2,3])};
 let current:ViewerDocument={id:crypto.randomUUID(),path:'/import.xyz',title:'import.xyz',extension:'xyz',renderer:'molstar'} as ViewerDocument;
 let text='1\nimported\nH 0 0 0\n';
 if(volumeOnly){const {gridToCube}=await import('../apps/desktop/src/lib/molecular-workbench/quantum');text=typeof volumeOnly==='string'?volumeOnly:gridToCube(science.grid!,science.atoms);const {openBrowserDevTextDocument}=await import('../apps/desktop/src/lib/browser-dev-documents');const {defaultPreferences}=await import('../apps/desktop/src/stores/settings-store');current=await openBrowserDevTextDocument('source.cube','cube',text,{...defaultPreferences,rendererMode:'molstar'});science=await runReaderTask({action:'parse',name:'source.cube',text});}
 else {adoptLogicalSource({documentId:current.id,extension:'xyz',text},'orbitals-test',null,['H']);addDocumentInternalCoordinates(current.id,text,science);}
 const plugin=new PluginContext({actions:[],behaviors:[]});await plugin.init();const raw=await plugin.builders.data.rawData({data:text});if(volumeOnly){await plugin.state.data.build().to(raw).apply(StateTransforms.Data.ParseCube).apply(StateTransforms.Volume.VolumeFromCube).commit();}else{const trajectory=await plugin.builders.structure.parseTrajectory(raw,'xyz');const model=await plugin.builders.structure.createModel(trajectory);await plugin.builders.structure.createStructure(model);}
 const scope:any={molstar:{lib:{plugin:{StateTransforms}}}};vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/geometry-preview.js',import.meta.url),'utf8'),{window:scope,crypto,TextEncoder,DataView,Uint8Array});
 const viewer={plugin},source=readFileSync(new URL('../PreviewExtension/Web/viewer.js',import.meta.url),'utf8');const start=source.indexOf("    if (type === 'show_scalar_field' || type === 'scalar_field_binding' || type === 'scalar_field_validate') {");
 const execute=new Function('window','activeMolstarViewer',`let scalarFieldRequest=0,scalarBindingRequest=0,geometryPreviewLoading=null;return async action=>{const type=action.type;${source.slice(start,source.indexOf("    if (type === 'preview_geometry') {",start))}};`)(scope,()=>viewer);
 const host=document.createElement('div');document.body.append(host);const frame=document.createElement('iframe');frame.className='viewer-iframe';frame.dataset.documentId=current.id;frame.dataset.renderer='molstar';host.append(frame);
 const panel=document.createElement('div');host.append(panel);const root=createRoot(panel);const calls:any[]=[],saved:Parameters<ShellActions['saveKetcherExportFile']>[0][]=[];let failSave=false,holdValidate=false,holdAck=false,releaseAck:(()=>void)|null=null;
 frame.contentWindow!.postMessage=payload=>{calls.push(payload.body.action);void execute(payload.body.action).then((result:unknown)=>{const reply=()=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{source:'burette-agent-viewer',body:{type:'agent-action-result',id:payload.body.id,result}}}));if((holdValidate&&payload.body.action.type==='scalar_field_validate')||(holdAck&&payload.body.action.cube)){holdValidate=false;holdAck=false;releaseAck=reply;}else reply();},(error:Error)=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{source:'burette-agent-viewer',body:{type:'agent-action-result',id:payload.body.id,result:{ok:false,error:{message:error.message}}}}})));};
 function Owner(){const api=useAppMolstarActionSenders({activeDocument:current,documents:[current],activeViewerIframeForDocument,pushStatus(){}});const actions={runStructureViewerAction:api.runStructureViewerAction,saveKetcherExportFile:async(request:Parameters<ShellActions['saveKetcherExportFile']>[0])=>{saved.push(request);return failSave?{status:'failed' as const,message:'Choose another destination.'}:{status:'saved' as const,path:null};}} as ShellActions;return <OrbitalsDockContent document={current} actions={actions}/>;}
 const render=async()=>{await act(async()=>root.render(<Owner/>));await wait(()=>Boolean(panel.querySelector('table')||[...panel.querySelectorAll('button')].some(button=>button.textContent==='Show surface')),'orbital controls');};await render();
 return {host:panel,frame,science,calls,saved,plugin,render,fields:()=>[...plugin.state.data.cells.values()].filter(cell=>cell.transform.tags?.includes('burette-scalar-field')).length,
  failSave:(value:boolean)=>{failSave=value;},holdValidate:()=>{holdValidate=true;},holdAck:()=>{holdAck=true;},ackHeld:()=>Boolean(releaseAck),releaseAck:()=>{releaseAck?.();releaseAck=null;},
  replaceScience:async(value:ScientificDocument)=>{await act(async()=>addDocumentInternalCoordinates(current.id,text,value));},
  replaceDocument:async()=>{current={...current};await render();},
  replaceText:async(next:string)=>{text=next;await act(async()=>{adoptLogicalSource({documentId:current.id,extension:'xyz',text},'orbitals-test',null,['H']);addDocumentInternalCoordinates(current.id,text,science);});await plugin.state.data.build().to(raw).update({data:text}).commit();},
  edit:async(edited:boolean)=>{const next=edited?'1\nedited\nH 0 0 1\n':text;frame.dataset.sourcePreviewRevision=crypto.randomUUID();await act(async()=>adoptLogicalSource({documentId:current.id,extension:'xyz',text:next},'orbitals-test',null,['H']));await plugin.state.data.build().to(raw).update({data:next}).commit();},
  close:async()=>{await act(async()=>root.unmount());await new Promise(r=>setTimeout(r,0));host.remove();plugin.dispose();if(volumeOnly){const {deleteBrowserDevVirtualTextDocument}=await import('../apps/desktop/src/lib/browser-dev-documents');deleteBrowserDevVirtualTextDocument(current.path);}releaseClosedImports(new Set());releaseClosedScienceSessions(new Set());},
 };
}
export const button=(host:HTMLElement,text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===text)!;
export const click=async(host:HTMLElement,text:string)=>{await act(async()=>button(host,text).click());};
