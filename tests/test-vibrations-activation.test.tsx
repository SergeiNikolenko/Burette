import { afterAll, afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act, useState } from 'react';
import { readFileSync } from 'node:fs';
import type { ShellActions, ShellViewState } from '../apps/desktop/src/components/types';
import type { ViewerDocument } from '../apps/desktop/src/types';
const browser=new Window({url:'http://localhost/'}), previous=new Map<string,PropertyDescriptor|undefined>();
for(const [name,value] of Object.entries({window:browser,self:browser,document:browser.document,navigator:browser.navigator,
 HTMLElement:browser.HTMLElement,Element:browser.Element,Node:browser.Node,HTMLInputElement:browser.HTMLInputElement,
 HTMLSelectElement:browser.HTMLSelectElement,HTMLButtonElement:browser.HTMLButtonElement,HTMLFormElement:browser.HTMLFormElement,
 DocumentFragment:browser.DocumentFragment,NodeFilter:browser.NodeFilter,SVGElement:browser.SVGElement,
 CustomEvent:browser.CustomEvent,Event:browser.Event,FocusEvent:browser.FocusEvent,KeyboardEvent:browser.KeyboardEvent,
 MouseEvent:browser.MouseEvent,PointerEvent:browser.PointerEvent,MutationObserver:browser.MutationObserver,CSS:browser.CSS,
 localStorage:browser.localStorage,getComputedStyle:browser.getComputedStyle.bind(browser),
 requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(performance.now()),0),cancelAnimationFrame:clearTimeout,
 ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},IS_REACT_ACT_ENVIRONMENT:true})){
 previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
}
afterAll(async()=>{await browser.happyDOM.close();for(const [name,value] of previous){if(value)Object.defineProperty(globalThis,name,value);else Reflect.deleteProperty(globalThis,name);}});
const {createRoot}=await import('react-dom/client');
const {DockPanel}=await import('../apps/desktop/src/components/dock-panel');
const {SceneComputeMenu}=await import('../apps/desktop/src/components/editor-area/scene-compute-menu');
const {CommandPalette}=await import('../apps/desktop/src/components/command-palette');
const {openScientificFiles}=await import('../apps/desktop/src/lib/workbench/open');
const {openBrowserDevTextDocument,readBrowserDevVirtualTextDocument,deleteBrowserDevVirtualTextDocument}=await import('../apps/desktop/src/lib/browser-dev-documents');
const {releaseClosedImports,scientificStateFor}=await import('../apps/desktop/src/lib/workbench/scientific-source-state');
const {useMoleculeStore}=await import('../apps/desktop/src/stores/molecule-store');
const {useTabWorkspaceStore,getTabWorkspace}=await import('../apps/desktop/src/stores/tab-workspace-store');
const {DEFAULT_XTB_SETTINGS,DEFAULT_CONFORMER_SETTINGS}=await import('../apps/desktop/src/lib/chemistry-settings');
const {defaultPreferences}=await import('../apps/desktop/src/stores/settings-store');
const opened:ViewerDocument[]=[];const before=useMoleculeStore.getState().documents;
afterEach(()=>{for(const doc of opened.splice(0))deleteBrowserDevVirtualTextDocument(doc.path);useMoleculeStore.setState({documents:before});releaseClosedImports(new Set(before.map(doc=>doc.id)));});
const openStructureRecords:ShellActions['openStructureRecords']=async records=>{
 const docs=await Promise.all(records.map(record=>openBrowserDevTextDocument(record.path,record.inputExtension,record.text,{...defaultPreferences,rendererMode:'molstar'})));
 opened.push(...docs);useMoleculeStore.setState(state=>({documents:[...state.documents,...docs]}));return docs;
};
async function fixture(){
 const file=new File(['\ufeff'+readFileSync(new URL('./fixtures/quantum/gaussian16-water-raman.fchk',import.meta.url),'utf8').replaceAll('\n','\r\n')],'water.fchk');
 await openScientificFiles({openStructureRecords},[file]);expect(opened).toHaveLength(1);const current=opened[0];
 const source=scientificStateFor(current.id,readBrowserDevVirtualTextDocument(current.path)!);expect(source.revision?.document.modes).toHaveLength(3);
 const other=await openBrowserDevTextDocument('other.xyz','xyz','1\nother\nH 0 0 0\n',defaultPreferences);opened.push(other);useMoleculeStore.setState(state=>({documents:[...state.documents,other]}));
 const workspace=`vibrations-${crypto.randomUUID()}`;getTabWorkspace(workspace);
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
  const dock=useTabWorkspaceStore(state=>state.workspaces[workspace].right);const [commands,setCommands]=useState(false);showCommands=()=>setCommands(true);
  const state:Partial<ShellViewState>={page:'viewer',documents,textDocuments:[],activeDocument:active,
   activeTab:{id:workspace,location:{kind:'document',path:current.path},back:[],forward:[]},preferences:defaultPreferences,
   rightDockTabs:dock.tabs,rightDockActiveTab:dock.activeTab,rightDockOpen:dock.open,rightDockDocumentId:dock.documentId,rightDockTool:null,
   dockDroppedStructures:[],hoveredGridRows:{},visibleDocuments:opened,sidebarProjects:[],xtbJobs:[],xtbSettings:DEFAULT_XTB_SETTINGS,conformerSettings:DEFAULT_CONFORMER_SETTINGS,buildInfo:{name:"Burette",version:"test",identifier:"test",flavor:null,isDevBuild:true,isBrowserDev:true,isAgentShell:false,notes:[],limitations:[]},
  };
  return <><button onClick={()=>setCommands(true)}>Commands</button>{active?<SceneComputeMenu document={active} actions={actions as ShellActions}/>:null}
   <DockPanel area="right" state={state as ShellViewState} actions={actions as ShellActions}/>
   {commands?<CommandPalette state={state as ShellViewState} actions={actions as ShellActions} isOpen query="vibrations" onQueryChange={()=>{}} onClose={()=>setCommands(false)} onRunError={error=>{throw error;}}/>:null}</>;
 }
 await act(async()=>root.render(<Workspace/>));
 return {host,current,other,workspace,source,saveRequests,showCommands,close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
const settle=async()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
const waitForPanel=async(host:HTMLElement)=>{for(let i=0;i<100&&!host.querySelector('table[aria-label="Vibrational modes"]');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});};

test('Compute routes the imported modes to its own dock document and leaves valid keyboard focus',async()=>{
 const view=await fixture();
 try{
  const trigger=view.host.querySelector<HTMLButtonElement>('button[aria-label="Open molecular compute menu"]')!;await act(async()=>trigger.focus());
  await act(async()=>trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  const item=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node=>node.textContent==='Show vibrations');expect(Boolean(item)).toBe(true);
  await act(async()=>item!.click());await settle();await waitForPanel(view.host);
  const dock=getTabWorkspace(view.workspace).right;expect([dock.documentId,dock.activeTab,dock.open]).toEqual([view.current.id,'vibrations',true]);
  const rows=[...view.host.querySelectorAll('table[aria-label="Vibrational modes"] tbody tr')];expect(rows.length).toBe(3);
  expect(rows.map(row=>row.querySelectorAll('td')[0].textContent)).toEqual(['2169.9','4141.3','4392.4']);
  const active=view.host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;expect(active.getAttribute('aria-label')).toBe('Vibrations');
  expect(document.activeElement===trigger||document.activeElement===active).toBe(true);
  await act(async()=>active.focus());expect(document.activeElement===active).toBe(true);
  expect([...view.host.querySelectorAll('button')].some(node=>node.textContent==='Export')).toBe(true);
  expect(view.host.querySelector('[aria-label="Spectrum display"]')).not.toBeNull();
 }finally{await view.close();}
});

test('command palette activates the same complete lazy panel without opening another compute workflow',async()=>{
 const view=await fixture();
 try{
  const trigger=[...view.host.querySelectorAll('button')].find(node=>node.textContent==='Commands')!;await act(async()=>trigger.focus());await act(async()=>trigger.click());await settle();
  const item=[...document.querySelectorAll<HTMLElement>('[cmdk-item]')].find(node=>node.textContent?.includes('Show vibrations'));expect(Boolean(item)).toBe(true);
  await act(async()=>item!.click());await settle();await waitForPanel(view.host);
  expect(getTabWorkspace(view.workspace).right.documentId).toBe(view.current.id);expect(getTabWorkspace(view.workspace).right.activeTab).toBe('vibrations');
  expect(view.host.querySelectorAll('table[aria-label="Vibrational modes"] tbody tr').length).toBe(3);
  expect(document.querySelector('[role="dialog"]')===null).toBe(true);
  const activeTab=view.host.querySelector('[role="tab"][aria-selected="true"]');
  expect(document.activeElement===trigger||document.activeElement===activeTab).toBe(true);
  expect(view.source.original?.name).toBe('water.fchk');
 }finally{await view.close();}
});


test('closing the last imported document releases science and Original while the right dock stays hidden',async()=>{
 const view=await fixture(), text=readBrowserDevVirtualTextDocument(view.current.path)!;
 try{
  expect(getTabWorkspace(view.workspace).right.open).toBe(false);
  expect(scientificStateFor(view.current.id,text).original?.name).toBe('water.fchk');
  await act(async()=>useMoleculeStore.setState(state=>({documents:state.documents.filter(doc=>doc.id!==view.current.id)})));
  const released=scientificStateFor(view.current.id,text);expect(released.revision).toBeNull();expect(released.original).toBeNull();
  expect(getTabWorkspace(view.workspace).right.open).toBe(false);
 }finally{await view.close();}
});

test('palette focus target cannot steal focus after document replacement or pane unmount',async()=>{
 const {focusVibrationsDock,openVibrations}=await import('../apps/desktop/src/lib/workbench/vibrations-tool');
 const view=await fixture();let closed=false;
 try{
  const controls={setDockDocument:(area:'right'|'bottom',id:string|null)=>useTabWorkspaceStore.getState().setDockDocument(view.workspace,area,id),openDockTab:(area:'right'|'bottom',kind:import('../apps/desktop/src/lib/dock').DockTabKind)=>useTabWorkspaceStore.getState().openDockTab(view.workspace,area,kind)};
  await act(async()=>openVibrations(controls,view.current.id));await waitForPanel(view.host);
  await act(async()=>openScientificFiles({openStructureRecords},[new File([readFileSync(new URL('./fixtures/quantum/gaussian16-water-raman.fchk',import.meta.url),'utf8')],'second.fchk')]));
  const replacement=opened.at(-1)!;expect(replacement.id===view.current.id).toBe(false);
  await act(async()=>openVibrations(controls,replacement.id));await waitForPanel(view.host);
  const trigger=[...view.host.querySelectorAll('button')].find(node=>node.textContent==='Commands')!;await act(async()=>trigger.focus());
  expect(focusVibrationsDock(view.current.id, view.workspace)).toBe(false);expect(document.activeElement===trigger).toBe(true);
  await view.close();closed=true;expect(focusVibrationsDock(replacement.id, view.workspace)).toBe(false);
 }finally{if(!closed)await view.close();}
});
