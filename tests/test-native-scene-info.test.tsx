import { expect, test, spyOn } from "bun:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { choose, browser, defaultPreferences, useMoleculeStore, logicalSourceFor, readSceneDocumentBytes } from "./test-molx-ordinary-chooser.test";
import { nativeCompositionFixture } from "./native-composition-fixture.mjs";
import type { ShellActions, ShellViewState, StructureViewerAction } from "../apps/desktop/src/components/types";
const { DockPanel } = await import("../apps/desktop/src/components/dock-panel");
const { ToolPage } = await import("../apps/desktop/src/components/workspace-panes/tool-page");
const { DEFAULT_XTB_SETTINGS, DEFAULT_CONFORMER_SETTINGS } = await import("../apps/desktop/src/lib/chemistry-settings");
const bytes = new Uint8Array(readFileSync(new URL("./fixtures/native/plain-peptide-PGI.molx", import.meta.url)));
async function settle(check: () => boolean) {
 for (let i=0;i<100&&!check();i++) await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
 expect(check()).toBe(true);
}

test("ordinary plain MOLX Info uses the live native hierarchy and existing Chain 7 selection/hide/remove controls", async () => {
 const doc = await choose(bytes, "actual-peptide-info.molx"), native = await nativeCompositionFixture(Buffer.from(bytes));
 const host = document.createElement("div"); host.className="app-shell"; document.body.append(host); const root=createRoot(host);
 const page = document.createElement("div"); page.className="page-surface"; page.dataset.active="true"; document.body.append(page);
 const frame = document.createElement("iframe"); frame.className="viewer-iframe"; frame.dataset.documentId=doc.id; frame.dataset.renderer="molstar"; page.append(frame);
 let pending=Promise.resolve<unknown>(null); const seen: StructureViewerAction[]=[];
 const actions = { setStructureDragActive() {}, runStructureViewerAction: (_doc: unknown, action: StructureViewerAction) => {
  seen.push(action); pending=pending.then(async()=>{
   if(action.type==="select_residues") return native.select(action);
   if(["hide_components","show_components","remove_components"].includes(action.type)) {
    const result=await native.edit(action,action.type.split("_")[0]);native.report();return result;
   }
   return null;
  }); return pending;
 }} as unknown as ShellActions;
 const state: Partial<ShellViewState>={page:"viewer",documents:useMoleculeStore.getState().documents,textDocuments:[],activeDocument:doc,
  activeTab:{id:doc.id,location:{kind:"file",path:doc.path,documentId:doc.id},back:[],forward:[]},preferences:defaultPreferences,
  rightDockTabs:[{id:"info",kind:"inspector"}],rightDockActiveTab:"inspector",rightDockOpen:true,rightDockDocumentId:doc.id,rightDockTool:null,
  dockDroppedStructures:[],hoveredGridRows:{},visibleDocuments:[doc],sidebarProjects:[],xtbJobs:[],xtbSettings:DEFAULT_XTB_SETTINGS,conformerSettings:DEFAULT_CONFORMER_SETTINGS,
  buildInfo:{name:"Burette",version:"test",identifier:"test",flavor:null,isDevBuild:true,isBrowserDev:true,isAgentShell:true,notes:[],limitations:[]}};
 const publish=(body: unknown, source: unknown=frame.contentWindow)=>window.dispatchEvent(new browser.MessageEvent("message",{source:source as never,data:{source:"burette-viewer",body:{...(body as object),type:"compositionVisibilityChanged",documentId:doc.id}}}) as unknown as Event);
 native.onPost(publish);
 const transport=spyOn(frame.contentWindow!,"postMessage").mockImplementation((message: unknown)=>{const body=(message as {body?:unknown}).body;if(body)native.receive(body);});
 try {
  await act(async()=>root.render(<><DockPanel area="right" state={state as ShellViewState} actions={actions}/><ToolPage tabId="info-tool" isActive location={{kind:"tool",area:"right",tool:"inspector",sourcePath:doc.path}} state={state as ShellViewState} actions={actions}/></>));
  await settle(()=>Boolean(host.textContent?.includes("Chain 7")));
  expect(host.querySelector(".structure-inspector-header-stats")?.textContent).toContain("Atoms43Chains1");
  expect([...host.querySelectorAll(".structure-inspector-header-stats")].map(node=>node.textContent)).toHaveLength(2);
  expect(native.last().hierarchyRequestIds).toHaveLength(2);
  expect(logicalSourceFor(doc.id)).toBeNull(); expect(await readSceneDocumentBytes(doc)).toEqual(bytes);
  const select=[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.hasAttribute("aria-pressed")&&button.textContent?.includes("Chain 7"))!;
  expect(Boolean(select)).toBe(true); await act(async()=>{select.click();await pending;});
  expect(native.plugin.managers.structure.selection.elementCount()).toBe(43);
  expect(seen.at(-1)).toMatchObject({type:"select_residues",selector:{kind:"polymer",auth_asym_id:"7"}});
  await act(async()=>{host.querySelector<HTMLButtonElement>('[aria-label="Hide chain 7"]')!.click();await pending;});
  expect(native.last().rows.find((row: {query:string})=>row.query==="all").counts.atoms).toBe(43);
  expect(host.querySelector('[aria-label="Show chain 7"]')).not.toBeNull();
  const snapshot=native.snapshot();
  await act(async()=>{host.querySelector<HTMLButtonElement>('[aria-label="Remove chain 7"]')!.click();await pending;});
  await settle(()=>!host.textContent?.includes("Chain 7"));
  expect(host.querySelector(".structure-inspector-header-stats")?.textContent).toContain("Atoms0");
  await act(async()=>{await native.restore(snapshot);native.report();});
  await settle(()=>Boolean(host.textContent?.includes("Chain 7")));
  expect([...host.querySelectorAll(".structure-inspector-header-stats")].every(node=>node.textContent?.includes("Atoms43Chains1"))).toBe(true);
  await act(async()=>root.render(<DockPanel area="right" state={state as ShellViewState} actions={actions}/>));
  await settle(()=>Boolean(host.textContent?.includes("Chain 7"))); expect(native.last().hierarchyRequestIds).toHaveLength(1);
  // Attribute ABA retires the old request even when the same Window and final attribute values remain.
  const beforeAba=native.last(); let held: unknown=null;
  transport.mockImplementation((message: unknown)=>{held=(message as {body:unknown}).body;});
  await act(async()=>{frame.dataset.sourcePreviewRevision="later";delete frame.dataset.sourcePreviewRevision;await new Promise(resolve=>setTimeout(resolve,0));publish(beforeAba);});
  expect(host.querySelector(".structure-inspector-header-stats")?.textContent ?? "").not.toContain("Atoms43");
  expect(beforeAba.hierarchyRequestIds).not.toContain((held as {requestId:string}).requestId);
  transport.mockImplementation((message: unknown)=>{const body=(message as {body?:unknown}).body;if(body)native.receive(body);});
  await act(async()=>native.receive(held)); await settle(()=>Boolean(host.textContent?.includes("Chain 7")));
  // Registry close/reopen ABA also retires source authority synchronously.
  const beforeClose=native.last(), docs=useMoleculeStore.getState().documents;
  transport.mockImplementation((message: unknown)=>{held=(message as {body:unknown}).body;});
  await act(async()=>{useMoleculeStore.setState({documents:docs.filter(value=>value!==doc)});useMoleculeStore.setState({documents:docs});publish(beforeClose);});
  expect(host.querySelector(".structure-inspector-header-stats")?.textContent ?? "").not.toContain("Atoms43");
  transport.mockImplementation((message: unknown)=>{const body=(message as {body?:unknown}).body;if(body)native.receive(body);});
  await act(async()=>native.receive(held)); await settle(()=>Boolean(host.textContent?.includes("Chain 7")));
  // Exact iframe lifetime: an old source cannot repopulate the mounted inspector.
  const oldWindow=frame.contentWindow!, old=native.last(); frame.remove();
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));publish(old,oldWindow);});
  expect(host.querySelector(".structure-inspector-header-stats")?.textContent ?? "").not.toContain("Atoms43");
  await act(async()=>root.unmount());publish(old,oldWindow);expect(host.childNodes.length).toBe(0);
 } finally {transport.mockRestore();native.onPost(null);await act(async()=>root.unmount());page.remove();host.remove();await native.close();}
});
