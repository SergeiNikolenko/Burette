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
  const operation=new Function("useCallback","activeDocument","pushErrorStatus","pushStatus","requestMolstarXtbContextDocument","xtbInputRequestForMolstarContextDocument","xtbInputRequestForDocument","runXtbJob","xtbOperationLabel",js+";return runXtbActiveOperation;")((fn:unknown)=>fn,active,()=>{},()=>{},requestContext,()=>({inputText:"selected atoms",label:"Selected atoms"}),()=>{throw new Error("Selection was lost");},run,()=>"Optimize geometry");
  await operation("optimize",target);
  expect(requestContext.mock.calls).toEqual([[target]]);
  expect(run.mock.calls[0]).toEqual([{operation:"optimize",inputText:"selected atoms",label:"Selected atoms"},{title:"Optimize geometry",inputLabel:"Selected atoms",openPrimary:false,openOptimizedPoseInCurrentView:true,poseSourceDocument:target}]);
});

test("PRISM reads the displayed derived ensemble, not its original provenance file", async () => {
  const source = readFileSync(new URL("../apps/desktop/src/hooks/use-app-conformer-workflows.ts", import.meta.url), "utf8");
  const section = source.slice(source.indexOf("  const runConformerOperation ="), source.indexOf("  return { runConformerJob"));
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(section);
  const derived = { id: "optimized", title: "Ligand optimization.xyz", extension: "xyz", path: "/generated/optimization.xyz", sourcePath: "/original/ligand.mol", renderer: "molstar", virtual: true };
  const run = mock(async () => {});
  const guard = mock(async () => null);
  const operation = new Function(
    "useCallback", "activeDocument", "pushStatus", "pushErrorStatus", "requestMolstarXtbContextDocument", "runConformerJob",
    "isTauriRuntime", "readBrowserDevVirtualTextDocument", "directChemistryJobGuardMessage", "canUseConformerWorkflow", "canInspectConformerEnsemble", "conformerOutputDirectory", "textToBase64",
    js + ";return runConformerOperation;",
  )((fn: unknown) => fn, derived, () => {}, () => {}, async () => null, run,
    () => true, () => null, guard, () => true, () => true, () => "/original", btoa);
  await operation("prism-prune", derived);
  expect(run.mock.calls).toEqual([[{
    operation: "prism-prune", path: derived.path, title: derived.title, extension: "xyz", inputDataBase64: null, outputDirectory: null,
  }]]);
  expect(guard.mock.calls).toEqual([["PRISM", null, "xyz", derived.path]]);
});

test("xTB keeps a successful result when opening its optimized pose fails", async () => {
  const source = readFileSync(new URL("../apps/desktop/src/hooks/use-app-xtb-workflows.ts", import.meta.url), "utf8");
  const section = source.slice(source.indexOf("  const runXtbJob ="), source.indexOf("  const runXtbActiveOperation ="));
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(section);
  const result = { ok: true, primaryOpenPath: "/result/xtbopt.xyz", artifacts: [], reportPath: "", logPath: "" };
  let jobs: Array<{ status: string; result: unknown; error: unknown }> = [];
  const openingError = new Error("Viewer could not load the optimized pose");
  const pushErrorStatus = mock(() => {});
  const dependencies = {
    useCallback: (fn: unknown) => fn,
    xtbOperationLabel: () => "Optimize geometry",
    directChemistryJobGuardMessage: async () => null,
    structureExtensionFromPath: () => "xyz",
    computeHost: () => null,
    setXtbJobs: (update: (previous: typeof jobs) => typeof jobs) => { jobs = update(jobs); },
    xtbSettings: { solvent: "none" },
    runXtbRequest: async () => result,
    cancelledXtbJobIdsRef: { current: new Set<string>() },
    requestXtbStatus: async () => ({}),
    setXtbStatus: () => {},
    openTextDocuments: () => {},
    openXtbOptimizedPoseInCurrentView: async () => { throw openingError; },
    openPaths: () => {}, openDockTab: () => {}, setDockActiveTab: () => {}, setDockOpen: () => {}, addDockDrop: () => {}, pushStatus: () => {}, pushErrorStatus,
  };
  const run = new Function(...Object.keys(dependencies), js + ";return runXtbJob;")(...Object.values(dependencies));
  await run({ operation: "optimize", inputPath: "/input.xyz" }, { openOptimizedPoseInCurrentView: true, openPrimary: false });
  expect(jobs.map(({ status, result: savedResult, error }) => ({ status, result: savedResult, error }))).toEqual([{ status: "success", result, error: null }]);
  expect(pushErrorStatus.mock.calls).toEqual([[openingError, "xTB results were saved, but the optimized pose could not be opened"]]);
});

test("calculation selection transport distinguishes no selection from timeout and viewer errors", async () => {
  const source = readFileSync(new URL("../apps/desktop/src/hooks/use-app-molstar-xtb-context.ts", import.meta.url), "utf8");
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(source.indexOf("export function")).replace("export function", "function"));
  for (const scenario of ["none", "selection", "timeout", "error", "malformed", "empty-context", "missing", "send-failure"] as const) {
    let receive: ((event: unknown) => void) | null = null;
    let expire = () => {};
    let requestId = "";
    const frame = { postMessage: (message: { body: { id: string } }) => { requestId = message.body.id; if (scenario === "send-failure") throw new Error("Detached viewer"); } };
    const timers = new Set<number>();
    const fakeWindow = {
      setTimeout: (callback: () => void) => { expire = callback; timers.add(1); return 1; },
      clearTimeout: (id: number) => timers.delete(id),
      addEventListener: (_name: string, listener: typeof receive) => { receive = listener; },
      removeEventListener: () => { receive = null; },
    };
    const hook = new Function("useCallback", "window", js + ";return useAppMolstarXtbContext;")((fn: unknown) => fn, fakeWindow);
    const { requestMolstarXtbContextDocument: request } = hook({ activeViewerIframeForDocument: () => scenario === "missing" ? null : { contentWindow: frame }, isKnownViewerMessageSource: () => true });
    const pending = request({ id: "target", renderer: "molstar" });
    const context = { entries: [{ data: "selected molecule", format: "mol" }] };
    if (scenario === "timeout") expire();
    else if (receive) (receive as (event: unknown) => void)({ source: frame, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: requestId, result: scenario === "malformed" ? {} : { ok: scenario !== "error", result: { contextDocument: scenario === "selection" ? context : scenario === "empty-context" ? { entries: [] } : null } } } } });
    if (scenario === "none" || scenario === "selection") expect(await pending).toEqual(scenario === "none" ? null : context);
    else await expect(pending).rejects.toThrow();
    expect({ listener: receive, timers: timers.size }).toEqual({ listener: null, timers: 0 });
  }
});

test("xTB and CREST stop before submitting a job when selection extraction fails", async () => {
  for (const kind of ["xtb", "conformer"] as const) {
    const source = readFileSync(new URL(`../apps/desktop/src/hooks/use-app-${kind}-workflows.ts`, import.meta.url), "utf8");
    const name = kind === "xtb" ? "runXtbActiveOperation" : "runConformerOperation";
    const end = kind === "xtb" ? "  const runXtbKetcherSketch" : "  return { runConformerJob";
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(source.indexOf(`  const ${name} =`), source.indexOf(end)));
    const error = new Error("The structure viewer did not respond");
    const submit = mock(async () => {}), notify = mock(() => {});
    const dependencies = {
      useCallback: (fn: unknown) => fn, activeDocument: null, pushStatus: () => {}, pushErrorStatus: notify,
      requestMolstarXtbContextDocument: async () => { throw error; }, runXtbJob: submit, runConformerJob: submit,
    };
    const run = new Function(...Object.keys(dependencies), js + `;return ${name};`)(...Object.values(dependencies));
    await run(kind === "xtb" ? "optimize" : "crest-generate", { id: "selected", renderer: "molstar", extension: "xyz", path: "/original.xyz" });
    expect(submit.mock.calls).toEqual([]);
    expect(notify.mock.calls).toEqual([[error, `${kind === "xtb" ? "xTB" : "CREST"} input could not be read; calculation was not started`]]);
  }
});
