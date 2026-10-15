import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { readFileSync } from "node:fs";
import type { ShellActions } from "../apps/desktop/src/components/types";
import type { ViewerDocument } from "../apps/desktop/src/types";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "CustomEvent", "getComputedStyle"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(fn,0), cancelAnimationFrame: clearTimeout });
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
