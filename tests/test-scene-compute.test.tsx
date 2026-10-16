import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "CustomEvent", "getComputedStyle", "localStorage", "HTMLFormElement", "HTMLSelectElement", "DocumentFragment"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
for (const [key, value] of Object.entries({ IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(fn,0), cancelAnimationFrame: clearTimeout })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const viewerBridge = await import("../apps/desktop/src/lib/viewer-bridge");
// The viewer reports which recorded scene files are still on screen.
mock.module("../apps/desktop/src/lib/viewer-bridge", () => ({ ...viewerBridge, requestViewerAction: async (_id: string, action: { type: string; paths?: string[] }) => action.type === "scene_source_paths" ? { paths: action.paths!.filter(path => !path.endsWith("removed.sdf")) } : {} }));
const { createRoot } = await import("react-dom/client");
const { SceneComputeMenu } = await import("../apps/desktop/src/components/editor-area/scene-compute-menu");

test("XYZ scene exposes Compute and dispatches the selected calculation for its own document", async () => {
  const container=document.createElement("div"); document.body.append(container); const root=createRoot(container);
  const target={id:"trajectory",path:"/trajectory.xyz",extension:"xyz",renderer:"molstar"} as ViewerDocument;
  const runXtbActiveOperation=mock(()=>{}), runConformerOperation=mock(()=>{});
  const actions={runXtbActiveOperation,runConformerOperation} as unknown as ShellActions;
  try {
    await act(async()=>root.render(<SceneComputeMenu document={target} actions={actions}/>));
    const trigger=container.querySelector<HTMLButtonElement>('button')!;
    expect(trigger.textContent).toContain("Compute");
    await act(async()=>{trigger.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0})); trigger.click();});
    const item=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el=>el.textContent==="Energy & charges")!;
    expect(item).toBeDefined(); await act(async()=>item.click());
    expect(runXtbActiveOperation.mock.calls).toEqual([["properties",target]]);
    await act(async()=>root.render(<SceneComputeMenu document={{...target,extension:"sdf"}} actions={actions}/>));
    expect(container.querySelector("button")).toBeNull();
  } finally {await act(async()=>root.unmount());container.remove();}
});

test("a scene built from several files offers every file and shows removed ones as unavailable", async () => {
  const container=document.createElement("div"); document.body.append(container); const root=createRoot(container);
  const scene={id:"scene",path:"burette-docking://scene",extension:"pdb",renderer:"molstar",sceneSourcePaths:["/run/protein.pdb","/run/ligand.sdf","/run/removed.sdf"]} as unknown as ViewerDocument;
  const runConformerOperation=mock(()=>{});
  const actions={runConformerOperation,runXtbJob:mock(()=>{}),runXtbActiveOperation:mock(()=>{})} as unknown as ShellActions;
  try {
    await act(async()=>root.render(<SceneComputeMenu document={scene} actions={actions}/>));
    const trigger=container.querySelector<HTMLButtonElement>('button')!;
    await act(async()=>{trigger.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0})); trigger.click();});
    await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
    const rows=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(rows.map(row=>[row.textContent,row.hasAttribute("data-disabled")])).toEqual([["protein.pdb",false],["ligand.sdf",false],["removed.sdf",true]]);
    expect(rows[2].querySelector("[title]")?.getAttribute("title")).toBe("Removed from the scene");
    await act(async()=>{rows[1].dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));});
    const generate=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el=>el.textContent==="Generate conformers")!;
    await act(async()=>generate.click());
    expect(runConformerOperation.mock.calls).toEqual([["crest-generate",scene,null,{scenePath:"/run/ligand.sdf"}]]);
  } finally {await act(async()=>root.unmount());container.remove();}
});

test("Run on lists enabled SSH connections and remembers the chosen host", async () => {
  localStorage.setItem("burette.ssh-projects.v1", JSON.stringify({ projects: [], connections: [{ host: "gauss", name: "Gauss", enabled: true }, { host: "old", name: "Old", enabled: false }] }));
  const container=document.createElement("div"); document.body.append(container); const root=createRoot(container);
  const xyz={id:"xyz",path:"/run/ligand.xyz",extension:"xyz",renderer:"xyzrender-external"} as unknown as ViewerDocument;
  try {
    await act(async()=>root.render(<SceneComputeMenu document={xyz} actions={{} as ShellActions}/>));
    const trigger=container.querySelector<HTMLButtonElement>('button')!;
    await act(async()=>{trigger.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0})); trigger.click();});
    const select=document.querySelector<HTMLSelectElement>('select[aria-label="Run on"]')!;
    expect([...select.options].map(option=>[option.value,option.textContent])).toEqual([["this-mac","This Mac"],["gauss","Gauss"]]);
    select.value="gauss";
    await act(async()=>{select.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(localStorage.getItem("burette.compute-host.v1")).toBe("gauss");
  } finally {await act(async()=>root.unmount());container.remove();localStorage.clear();}
});

test("scene calculations extract the clicked viewer selection rather than an unrelated active tab", async () => {
  const source=readFileSync(new URL("../apps/desktop/src/hooks/use-app-xtb-workflows.ts",import.meta.url),"utf8");
  const section=source.slice(source.indexOf("  const runXtbActiveOperation ="),source.indexOf("  const runXtbKetcherSketch ="));
  const js=new Bun.Transpiler({loader:"ts"}).transformSync(section);
  const active={id:"other",path:"/other.xyz"};const target={id:"clicked",path:"/clicked.xyz",title:"Clicked molecule"};
  const requestContext=mock(async()=>({entries:[{data:"selected atoms"}]}));const run=mock(async()=>{});
  const operation=new Function("useCallback","activeDocument","pushStatus","requestMolstarXtbContextDocument","xtbInputRequestForMolstarContextDocument","xtbInputRequestForDocument","runXtbJob","xtbOperationLabel",js+";return runXtbActiveOperation;")((fn:unknown)=>fn,active,()=>{},requestContext,()=>({inputText:"selected atoms",label:"Selected atoms"}),()=>{throw new Error("Selection was lost");},run,()=>"Optimize geometry");
  await operation("optimize",target);
  expect(requestContext.mock.calls).toEqual([[target]]);
  expect(run.mock.calls[0]).toEqual([{operation:"optimize",inputText:"selected atoms",label:"Selected atoms"},{title:"Optimize geometry",inputLabel:"Selected atoms",openPrimary:false,openOptimizedPoseInCurrentView:true,poseSourceDocument:target}]);
});
