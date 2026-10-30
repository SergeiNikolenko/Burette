import { afterAll, afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act, useState } from 'react';
import {flushSync} from 'react-dom';
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
 let workspace=`vibrations-${crypto.randomUUID()}`;getTabWorkspace(workspace);
 const store=useTabWorkspaceStore.getState();store.setDockDocument(workspace,'right',other.id);store.openDockTab(workspace,'right','text');store.setDockOpen(workspace,'right',false);
 const host=document.createElement('div');host.className='app-shell';document.body.append(host);const root=createRoot(host);
 const saveRequests:string[]=[];let showCommands:()=>void=()=>{};let closing:()=>void=()=>{};
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
   {commands?<CommandPalette state={state as ShellViewState} actions={actions as ShellActions} isOpen query="vibrations" onQueryChange={()=>{}} onClose={()=>{setCommands(false);queueMicrotask(closing);}} onRunError={error=>{throw error;}}/>:null}</>;
 }
 await act(async()=>root.render(<Workspace/>));
 return {host,current,other,workspace,source,saveRequests,showCommands,onClosing:(callback:()=>void)=>{closing=callback;},switchWorkspace:(next:string)=>{workspace=next;useMoleculeStore.setState(state=>({documents:[...state.documents]}));},close:async()=>{await act(async()=>root.unmount());host.remove();}};
}
const settle=async()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
const waitForPanel=async(host:HTMLElement)=>{for(let i=0;i<100&&!host.querySelector('table[aria-label="Vibrational modes"]');i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});};


test('independent review: a pending Palette close cannot focus another workspace showing the same source document',async()=>{
 const view=await fixture();const input=document.createElement('input');input.setAttribute('aria-label','New workspace input');document.body.append(input);
 const next=`review-next-${crypto.randomUUID()}`;getTabWorkspace(next);const store=useTabWorkspaceStore.getState();store.setDockDocument(next,'right',view.current.id);store.openDockTab(next,'right','vibrations');
 let focusedBeforeClose=false;
 try{
  await act(async()=>view.showCommands());await settle();
  view.onClosing(()=>{flushSync(()=>view.switchWorkspace(next));input.focus();focusedBeforeClose=document.activeElement===input;});
  const item=[...document.querySelectorAll<HTMLElement>('[cmdk-item]')].find(node=>node.textContent?.includes('Show vibrations'))!;
  expect(Boolean(item)).toBe(true);await act(async()=>item.click());await settle();await waitForPanel(view.host);
  expect(focusedBeforeClose).toBe(true);
  const pane=view.host.querySelector<HTMLElement>('aside[data-area="right"]')!;expect(pane.dataset.documentId).toBe(view.current.id);expect(pane.dataset.workspaceId).toBe(next);
  expect({inputFocused:document.activeElement===input,label:document.activeElement?.getAttribute('aria-label')}).toEqual({inputFocused:true,label:'New workspace input'});
 }finally{await view.close();input.remove();}
});
