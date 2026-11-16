import { afterAll, afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {IDBFactory} from 'fake-indexeddb';
import React, { act, useState } from 'react';
import { readFileSync } from 'node:fs';
import type { ShellActions, ShellViewState } from '../apps/desktop/src/components/types';
import type { ViewerDocument } from '../apps/desktop/src/types';
const browser=new Window({url:'http://localhost/'}), previous=new Map<string,PropertyDescriptor|undefined>();
for(const [name,value] of Object.entries({window:browser,self:browser,document:browser.document,navigator:browser.navigator,
 HTMLElement:browser.HTMLElement,Element:browser.Element,Node:browser.Node,HTMLInputElement:browser.HTMLInputElement,
 HTMLSelectElement:browser.HTMLSelectElement,HTMLButtonElement:browser.HTMLButtonElement,HTMLFormElement:browser.HTMLFormElement,
 DOMRect:browser.DOMRect,DocumentFragment:browser.DocumentFragment,NodeFilter:browser.NodeFilter,SVGElement:browser.SVGElement,
 CustomEvent:browser.CustomEvent,Event:browser.Event,FocusEvent:browser.FocusEvent,KeyboardEvent:browser.KeyboardEvent,
 MouseEvent:browser.MouseEvent,PointerEvent:browser.PointerEvent,MutationObserver:browser.MutationObserver,CSS:browser.CSS,
 indexedDB:new IDBFactory(),localStorage:browser.localStorage,getComputedStyle:browser.getComputedStyle.bind(browser),
 requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(performance.now()),0),cancelAnimationFrame:clearTimeout,
 ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true})){
 previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
}
afterAll(async()=>{await browser.happyDOM.close();for(const [name,value] of previous){if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name);}});
const {createRoot}=await import('react-dom/client');
const {DockPanel}=await import('../apps/desktop/src/components/dock-panel');
const {fileKind}=await import('../apps/desktop/src/components/editor-area/page-kinds/file');
const FilePage=fileKind.Component;
const {CommandPalette}=await import('../apps/desktop/src/components/command-palette');
const {useAppFileOpen}=await import('../apps/desktop/src/hooks/use-app-file-open');
const {registerDroppedBrowserFiles}=await import('../apps/desktop/src/lib/web-demo-workspace');
const {detectContentSpectrumPaths}=await import('../apps/desktop/src/lib/content-spectrum-detection');
const {openBrowserDevTextDocument,readBrowserDevVirtualTextDocument,writeBrowserDevVirtualTextDocument,deleteBrowserDevVirtualTextDocument}=await import('../apps/desktop/src/lib/browser-dev-documents');
const {releaseClosedImports,scientificStateFor}=await import('../apps/desktop/src/lib/workbench/scientific-source-state');
const {useMoleculeStore}=await import('../apps/desktop/src/stores/molecule-store');
const {useTabWorkspaceStore,getTabWorkspace,WINDOW_TOOLS_ID}=await import('../apps/desktop/src/stores/tab-workspace-store');
const {DEFAULT_XTB_SETTINGS,DEFAULT_CONFORMER_SETTINGS}=await import('../apps/desktop/src/lib/chemistry-settings');
const {defaultPreferences}=await import('../apps/desktop/src/stores/settings-store');
const opened:ViewerDocument[]=[];const before=useMoleculeStore.getState().documents;
afterEach(()=>{for(const doc of opened.splice(0))deleteBrowserDevVirtualTextDocument(doc.path);useMoleculeStore.setState({documents:before});releaseClosedImports(new Set(before.map(doc=>doc.id)));});
const openStructureRecords:ShellActions['openStructureRecords']=async records=>{
 const docs=await Promise.all(records.map(record=>openBrowserDevTextDocument(record.path,record.inputExtension,record.text,{...defaultPreferences,rendererMode:'molstar'})));
 opened.push(...docs);useMoleculeStore.setState(state=>({documents:[...state.documents,...docs]}));return docs;
};
async function openThroughApp(file:File) {
 const baseline=useMoleculeStore.getState().documents,noop=()=>{};let api!:ReturnType<typeof useAppFileOpen>;
 const options:Parameters<typeof useAppFileOpen>[0]={...useMoleculeStore.getState(),preferences:{...defaultPreferences,rendererMode:'molstar'},
  addProjectRoot:noop,detectContentSpectrumPaths,expandStructureBundles:async paths=>paths,openDockTab:noop,openDocumentTab:noop,openFepNetworkTab:noop,
  pushErrorStatus:error=>{throw error;},pushStatus:noop,rememberRecentStructures:noop,setDockActiveTab:noop,setDockDocument:noop,setDockOpen:noop};
 function Dispatcher(){api=useAppFileOpen(options);return null;}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(<Dispatcher/>));
  const saved=await registerDroppedBrowserFiles([file],16*1024*1024,{scientific:true});expect(saved.errors).toEqual([]);expect(saved.paths).toHaveLength(1);
  await act(async()=>{await api.openPaths(saved.paths,{requireSuccess:true});});
  opened.push(...useMoleculeStore.getState().documents.filter(doc=>!baseline.includes(doc)));
 }finally{await act(async()=>root.unmount());host.remove();}
}
async function fixture(kind: "cjson" | "cjson-no-spectra" | "mol" | "sdf" | "xyz" | "cif" = "cjson", options: { original?: string; query?: string; area?: "right" | "bottom" } = {}) {
 let original=options.original??readFileSync(new URL('./fixtures/quantum/spectra-native-nmr.cjson',import.meta.url),'utf8');
 if(kind==='cjson-no-spectra'){const value=JSON.parse(original);delete value.spectra;original=JSON.stringify(value);}
 if(kind.startsWith('cjson')) await openThroughApp(new File([original],`nmr-${crypto.randomUUID()}.cjson`));
 else {
  const {readCjsonGraph}=await import('../apps/desktop/src/lib/molecular-workbench/cjson-graph');
  const text=kind==='mol'||kind==='sdf'?readCjsonGraph('nmr.cjson',original).structure.molfile+(kind==='sdf'?'$$$$\n':'')
   :kind==='xyz'?'1\nplain\nH 0 0 0\n':'data_plain\n_cell_length_a 4\n_cell_length_b 4\n_cell_length_c 4\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nH1 H 0 0 0\n';
  await openStructureRecords([{path:'plain.'+kind,inputExtension:kind,text}]);
 }
 expect(opened).toHaveLength(1);const current=opened[0];
 const source=scientificStateFor(current.id,readBrowserDevVirtualTextDocument(current.path)!);
 if(kind==='cjson') expect(source.revision?.document.spectra?.spectra[0].kind).toBe('nmr');
 const other=await openBrowserDevTextDocument('other.xyz','xyz','1\nother\nH 0 0 0\n',defaultPreferences);opened.push(other);useMoleculeStore.setState(state=>({documents:[...state.documents,other]}));
 const workspace=`vibrations-${crypto.randomUUID()}`;getTabWorkspace(workspace);getTabWorkspace(WINDOW_TOOLS_ID);
 const store=useTabWorkspaceStore.getState();store.setDockDocument(workspace,'right',other.id);store.openDockTab(workspace,'right','text');store.setDockOpen(workspace,'right',false);
 const host=document.createElement('div');host.className='app-shell';document.body.append(host);const root=createRoot(host);
 const saveRequests:string[]=[];let showCommands:()=>void=()=>{};
 const actions:Partial<ShellActions>={openStructureRecords,setStructureDragActive(){},
  setDockDocument:(area,documentId)=>useTabWorkspaceStore.getState().setDockDocument(workspace,area,documentId),
  openDockTab:(area,kind)=>useTabWorkspaceStore.getState().openDockTab(workspace,area,kind),
  setDockActiveTab:(area,kind)=>useTabWorkspaceStore.getState().setDockActiveTab(workspace,area,kind),
  setDockOpen:(area,open)=>useTabWorkspaceStore.getState().setDockOpen(workspace,area,open),
  closeDockTab:(area,id)=>useTabWorkspaceStore.getState().closeDockTab(workspace,area,id),
  saveKetcherExportFile:async request=>{saveRequests.push(request.text);return {status:'saved',path:null};},
  runStructureViewerAction:async()=>{throw new Error('No primary viewer is mounted in this focus test');},
 } satisfies Pick<ShellActions,'openStructureRecords'|'setStructureDragActive'|'setDockDocument'|'openDockTab'|'setDockActiveTab'|'setDockOpen'|'closeDockTab'|'saveKetcherExportFile'|'runStructureViewerAction'>;
 function Workspace(){
  const documents=useMoleculeStore(state=>state.documents);const active=documents.find(doc=>doc.id===current.id)??null;
  const dock=useTabWorkspaceStore(state=>state.workspaces[workspace].right), bottom=useTabWorkspaceStore(state=>state.workspaces[WINDOW_TOOLS_ID]?.bottom??state.workspaces[workspace].bottom);const [commands,setCommands]=useState(false);showCommands=()=>setCommands(true);
  const state:Partial<ShellViewState>={tabs:useMoleculeStore.getState().tabs,activeTabId:workspace,page:'viewer',documents,textDocuments:[],activeDocument:active,
   activeTab:{id:workspace,location:{kind:'document',path:current.path},back:[],forward:[]},preferences:defaultPreferences,
   rightDockTabs:dock.tabs,rightDockActiveTab:dock.activeTab,rightDockOpen:dock.open,rightDockDocumentId:dock.documentId,rightDockTool:null,bottomDockTabs:bottom.tabs,bottomDockActiveTab:bottom.activeTab,bottomDockOpen:bottom.open,bottomDockDocumentId:bottom.documentId,bottomDockTool:null,
   dockDroppedStructures:[],hoveredGridRows:{},visibleDocuments:opened,sidebarProjects:[],xtbJobs:[],xtbSettings:DEFAULT_XTB_SETTINGS,conformerSettings:DEFAULT_CONFORMER_SETTINGS,buildInfo:{name:"Burette",version:"test",identifier:"test",flavor:null,isDevBuild:true,isBrowserDev:true,isAgentShell:false,notes:[],limitations:[]},
  };
  return <><button onClick={()=>setCommands(true)}>Commands</button>{active?<FilePage tabId={workspace} location={{kind:"file",documentId:active.id,path:active.path}} state={state as ShellViewState} actions={actions as ShellActions} isActive/>:null}
   <DockPanel area={options.area??"right"} state={state as ShellViewState} actions={actions as ShellActions}/>
   {commands?<CommandPalette state={state as ShellViewState} actions={actions as ShellActions} isOpen query={options.query??"spectra"} onQueryChange={()=>{}} onClose={()=>setCommands(false)} onRunError={error=>{throw error;}}/>:null}</>;
 }
 await act(async()=>root.render(<Workspace/>));
 return {host,current,other,workspace,source,saveRequests,showCommands,close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
const settle=async()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
const waitForPanel=async(host:HTMLElement)=>{for(let i=0;i<100&&!host.querySelector('table[aria-label="NMR source values"]');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});};


test('review retained Files and Logs use distinct sibling keys with explicit real workspace tabs',async()=>{
 const errors:unknown[][]=[],originalError=console.error;console.error=(...args)=>{if(String(args[0]).includes('same key'))errors.push(args);originalError(...args);};
 const view=await fixture('xyz',{area:'bottom'});
 try{
  await act(async()=>useMoleculeStore.setState({tabs:[{id:view.workspace,location:{kind:'file',path:view.current.path,documentId:view.current.id},back:[],forward:[]}],activeTabId:view.workspace,activeDocumentId:view.current.id}));
  await act(async()=>{const state=useTabWorkspaceStore.getState();state.setDockDocument(WINDOW_TOOLS_ID,'bottom',view.current.id);state.openDockTab(WINDOW_TOOLS_ID,'bottom','files');});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  expect(view.host.querySelector('[data-area="bottom"]')?.getAttribute('data-active-tab')).toBe('files');
  await act(async()=>useTabWorkspaceStore.getState().openDockTab(WINDOW_TOOLS_ID,'bottom','logs'));
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  expect(view.host.querySelector('[data-area="bottom"]')?.getAttribute('data-active-tab')).toBe('logs');
  expect(errors).toHaveLength(0);
 }finally{console.error=originalError;await view.close();useMoleculeStore.setState({tabs:[],activeTabId:null,activeDocumentId:null});}
});
