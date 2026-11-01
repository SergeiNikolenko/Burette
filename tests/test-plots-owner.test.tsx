import { afterAll, expect, test } from "bun:test";
import React, { act } from "react";
import { readFileSync } from "node:fs";
const { fixture, browser } = await import("./test-cjson-compute-owner.test");
import { fixture as nativeFixture, closeRuntime } from "./fixtures/retained-trajectory-native.mjs";
const { getTabWorkspace, useTabWorkspaceStore, WINDOW_TOOLS_ID } = await import("../apps/desktop/src/stores/tab-workspace-store");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { readBrowserDevVirtualTextDocument, writeBrowserDevVirtualTextDocument } = await import("../apps/desktop/src/lib/browser-dev-documents");
const { scientificStateFor } = await import("../apps/desktop/src/lib/workbench/scientific-source-state");
const { focusToolDock } = await import("../apps/desktop/src/lib/workbench/focus-tool-dock");
afterAll(closeRuntime);
const primary=JSON.parse(readFileSync(new URL("./fixtures/trajectory/retained-nmr.cjson",import.meta.url),"utf8"));
const wait=async(predicate:()=>boolean)=>{for(let i=0;i<100;i++){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});if(predicate())return;}throw new Error("Plots owner did not settle");};
async function chooseAtoms(host:HTMLElement,value:string){const input=host.querySelector<HTMLInputElement>('[aria-label="Atom numbers to measure"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new browser.Event("input",{bubbles:true}) as unknown as Event);});}

for(const route of ["compute","palette"]) test(`${route} opens source-owned active5 Plots without changing the native graph or Original`,async()=>{
  const original=JSON.stringify({...primary,atoms:{...primary.atoms,coords:{...primary.atoms.coords,"3dSetsActive":5}}});
  const proto=browser.HTMLElement.prototype, previous=Object.getOwnPropertyDescriptor(proto,"getBoundingClientRect");
  Object.defineProperty(proto,"getBoundingClientRect",{configurable:true,value:()=>({x:0,y:0,top:0,left:0,right:640,bottom:144,width:640,height:144})});
  for(const name of ["clientWidth","offsetWidth"])Object.defineProperty(proto,name,{configurable:true,get:()=>640});
  for(const name of ["clientHeight","offsetHeight"])Object.defineProperty(proto,name,{configurable:true,get:()=>144});
  const view=await fixture("cjson",{original,query:"plots",area:"bottom"});
  const text=readBrowserDevVirtualTextDocument(view.current.path)!, native=await nativeFixture(text,"mol"), snapshot=native.plugin.state.data.getSnapshot();
  const source=scientificStateFor(view.current.id,text), calls:unknown[]=[];
  const iframe=view.host.querySelector<HTMLIFrameElement>(`.molecule-stage[data-drop-document-id="${view.current.id}"] iframe`)!;
  iframe.contentWindow!.postMessage=value=>{calls.push(value);};
  try{
   if(route==="compute"){
    await wait(()=>Boolean(view.host.querySelector('[aria-label="Open molecular compute menu"]')));
    await act(async()=>view.host.querySelector<HTMLElement>('[aria-label="Open molecular compute menu"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
    const items=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];expect(items.map(item=>item.textContent)).toEqual(["Show spectra","Show plots","Build polymer…"]);
    await act(async()=>items.find(item=>item.textContent==="Show plots")!.click());
   }else{
    await act(async()=>view.showCommands());await wait(()=>[...document.querySelectorAll('[cmdk-item]')].some(item=>item.textContent?.includes("Show plots")));
    await act(async()=>[...document.querySelectorAll<HTMLElement>('[cmdk-item]')].find(item=>item.textContent?.includes("Show plots"))!.click());
   }
   await wait(()=>Boolean(view.host.querySelector('[aria-label="Atom numbers to measure"]')));
   expect([getTabWorkspace(WINDOW_TOOLS_ID).bottom.documentId,getTabWorkspace(WINDOW_TOOLS_ID).bottom.activeTab]).toEqual([view.current.id,"plots"]);
   expect(view.host.textContent).toContain("Frame 6 of 7");expect(view.host.textContent).not.toContain("Export forces");expect(view.host.textContent).not.toContain("Open steps");
   expect(view.host.querySelector('[aria-label="Energy unit"]')).toBeNull();expect(view.host.querySelector('[aria-label="Temperature per frame"]')).toBeNull();
   await chooseAtoms(view.host,"1 2");await wait(()=>view.host.textContent?.includes("Distance, Å1.200")??false);
   const path=view.host.querySelector('.recharts-line path.recharts-curve')!;
   expect(path).not.toBeNull();
   const points=[...path.getAttribute("d")!.matchAll(/[ML]([\d.-]+),([\d.-]+)/gu)].map(match=>[Number(match[1]),Number(match[2])]);
   const labels=[...view.host.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')].map(label=>({value:Number(label.textContent),y:Number(label.getAttribute("y"))}));
   const distances=[1.2006257364669461,1.2076004908856757,1.207148138965056,1.203060011575511,1.2002628167009621,1.2003876259138908,1.2006056263914924];
   expect(points).toHaveLength(7);expect(labels.length).toBeGreaterThan(1);
   const [low,high]=[labels[0],labels.at(-1)!];
   for(let i=0;i<7;i++){const expectedY=low.y+(distances[i]-low.value)*(high.y-low.y)/(high.value-low.value);expect(Math.abs(points[i][1]-expectedY)).toBeLessThan(0.005);if(i)expect(points[i][0]).toBeGreaterThan(points[i-1][0]);}
   const currentDot=view.host.querySelector('.recharts-reference-dot circle')!;
   expect(Number(currentDot.getAttribute("cx"))).toBeCloseTo(points[5][0],2);
   expect(Number(currentDot.getAttribute("cy"))).toBeCloseTo(points[5][1],2);
   expect(view.host.querySelector('[role="slider"]')).toBeNull();
   const chart=view.host.querySelector<HTMLElement>('[aria-label="Distance per frame"]')!;
   for(const key of ["Home","End","ArrowLeft","ArrowRight"])await act(async()=>chart.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true})));
   await act(async()=>chart.click());expect(native.plugin.state.data.getSnapshot()).toEqual(snapshot);
   expect(calls.filter((value:any)=>value?.body?.action?.type==="set_structure_pose")).toHaveLength(0);
   expect(scientificStateFor(view.current.id,text).revision).toBe(source.revision);expect(await source.original!.file.text()).toBe(original);
   expect(focusToolDock("plots",view.other.id,view.workspace)).toBe(false);expect(focusToolDock("plots",view.current.id,"wrong-workspace")).toBe(false);
   await act(async()=>{expect(focusToolDock("plots",view.current.id,view.workspace)).toBe(true);});
   // A source revision change removes eligibility; restoring the exact source reacquires its active cursor.
   await act(async()=>{writeBrowserDevVirtualTextDocument(view.current.path,text+"\n");useMoleculeStore.setState(state=>({documents:state.documents.map(doc=>doc.id===view.current.id?{...doc}:doc)}));});
   await wait(()=>!view.host.querySelector('[aria-label="Atom numbers to measure"]'));
   await act(async()=>{writeBrowserDevVirtualTextDocument(view.current.path,text);useMoleculeStore.setState(state=>({documents:state.documents.map(doc=>doc.id===view.current.id?{...doc}:doc)}));});
   await wait(()=>Boolean(view.host.querySelector('[aria-label="Atom numbers to measure"]')));expect(view.host.textContent).toContain("Frame 6 of 7");
  }finally{native.close();await view.close();if(previous)Object.defineProperty(proto,"getBoundingClientRect",previous);else Reflect.deleteProperty(proto,"getBoundingClientRect");for(const name of ["clientWidth","clientHeight","offsetWidth","offsetHeight"])Reflect.deleteProperty(proto,name);}
});


test("plots-only XYZ becomes available after the palette opens and opens its own bottom panel", async () => {
  const raw="2\nfirst\nC 0 0 0\nO 1 0 0\n2\nsecond\nC 0 0 0\nO 2 0 0\n";
  const view=await fixture("xyz",{original:raw,query:"plots",area:"bottom"});
  try {
    await act(async()=>view.showCommands());
    await wait(()=>[...document.querySelectorAll('[cmdk-item]')].some(item=>item.textContent?.includes("Show plots")));
    await act(async()=>[...document.querySelectorAll<HTMLElement>('[cmdk-item]')].find(item=>item.textContent?.includes("Show plots"))!.click());
    await wait(()=>Boolean(view.host.querySelector('[aria-label="Atom numbers to measure"]')));
    expect([getTabWorkspace(WINDOW_TOOLS_ID).bottom.documentId,getTabWorkspace(WINDOW_TOOLS_ID).bottom.activeTab]).toEqual([view.current.id,"plots"]);
    expect(view.host.textContent).toContain("2 frames");
    expect(readBrowserDevVirtualTextDocument(view.current.path)).toBe(raw);
  } finally {await view.close();}
});
