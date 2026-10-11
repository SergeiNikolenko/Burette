import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { JobsPanel } = await import("../apps/desktop/src/components/jobs-panel");

test("mixed jobs use one ordered list, keep error details collapsed and preserve actions", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const calls: unknown[] = [];
  const actions = {
    selectDocument: (id: string) => calls.push(id),
    cancelConformerJob: (id: string) => calls.push(id), openPaths: (paths: string[]) => calls.push(paths),
    cancelXtbJob: (id: string) => calls.push(id), openTextPaths: (paths: string[]) => calls.push(paths),
    clearConformerJobs() { calls.push("clear-compute"); }, clearXtbJobs() { calls.push("clear-xtb"); }, clearDerivedColumnJobs() { calls.push("clear-columns"); }, clearDatabaseJobs() { calls.push("clear-database"); },
  } as unknown as ShellActions;
  const state = {
    conformerJobs: [
      {id:"old",title:"Failed energy",status:"failed",startedAt:1,inputTitle:"a.sdf",error:"Full technical error",reportPath:"/failure.md"},
      {id:"active",title:"Alignment",status:"running",startedAt:2,inputTitle:"b.sdf",cancelable:true},
      {id:"done",title:"MMFF",status:"success",startedAt:3,inputTitle:"b.sdf",primaryOpenPath:"/result.sdf",reportPath:"/report.md",logPath:"/run.log"},
    ], xtbJobs: [{id:"xtb",title:"xTB",status:"running",startedAt:0,inputLabel:"water.sdf"}], databaseJobs: [{id:"db",title:"Structure search",status:"success",startedAt:0,query:"aspirin",recordCount:3,documentId:"database-result",warnings:["One record has no 3D coordinates"]}],
    derivedColumnJobs: [{id:"scaffold",columnLabel:"Scaffolds",documentTitle:"series.csv",status:"success",startedAt:4,processedRows:8,failedRows:1,totalRows:8}],
  } as unknown as ShellViewState;
  try {
    await act(async () => { root.render(<JobsPanel state={state} actions={actions} />); });
    expect([...container.querySelectorAll("li strong")].map(node => node.textContent)).toEqual(["Alignment", "xTB", "Scaffolds", "MMFF", "Failed energy", "Structure search"]);
    expect([...container.querySelectorAll(".jobs-panel-toggle")].every(button => button.getAttribute("aria-expanded") === "false")).toBe(true);
    expect([...container.querySelectorAll("li > p")]).toHaveLength(0);
    expect([...container.querySelectorAll(".jobs-panel-toggle")].map(node => node.textContent)).toEqual(["AlignmentRunning", "xTBRunning", "ScaffoldsPartial", "MMFFDone", "Failed energyFailed", "Structure searchDone"]);
    expect(container.textContent).not.toContain("Full technical error");
    expect(container.textContent).toContain("Partial");
    expect(container.textContent).not.toContain("No xTB");
    for (const label of ["Cancel", "Open result"]) {
      await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click(); });
    }
    expect(calls).toEqual(["active", ["/result.sdf"]]);
    const rows = [...container.querySelectorAll("li")];
    for (const title of ["xTB", "Failed energy", "MMFF"]) {
      const row = rows.find(row => row.querySelector("strong")?.textContent === title)!;
      if (title === "MMFF") await act(async () => row.querySelector<HTMLButtonElement>(".jobs-panel-toggle")!.click());
      const labels = title === "xTB" ? ["Cancel"] : title === "MMFF" ? ["Report", "Log"] : ["Report"];
      for (const label of labels) await act(async () => { [...row.querySelectorAll("button")].find(button=>button.textContent===label)!.click(); });
    }
    const search = rows.find(row => row.querySelector("strong")?.textContent === "Structure search")!;
    await act(async () => search.querySelector<HTMLButtonElement>(".jobs-panel-toggle")!.click());
    expect(search.textContent).toContain("3 records");
    await act(async () => Array.from(search.querySelectorAll("button")).find(button => button.textContent === "Open result")!.click());
    const failed = rows.find(row => row.querySelector("strong")?.textContent === "Failed energy")!;
    await act(async () => failed.querySelector<HTMLButtonElement>(".jobs-panel-toggle")!.click());
    expect(failed.textContent).toContain("a.sdf");
    expect(failed.textContent).not.toContain("Full technical error");
    await act(async () => Array.from(failed.querySelectorAll("button")).find(button => button.textContent === "Details")!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Full technical error");
    await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(document.activeElement?.textContent).toBe("Details");
    await act(async () => { [...container.querySelectorAll("button")].find(button=>button.textContent==="Clear finished")!.click(); });
    const beforeClear = [...calls];
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(button => button.textContent === "Cancel")!.click());
    expect(calls).toEqual(beforeClear);
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Clear finished")!.click());
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(button => button.textContent === "Clear finished")!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(document.activeElement).toBe(container.querySelector(".jobs-panel"));
    expect(calls.slice(2)).toEqual(["xtb", ["/failure.md"], ["/report.md"], ["/run.log"], "database-result", "clear-compute", "clear-xtb", "clear-columns", "clear-database"]);
  } finally { await act(async () => { root.unmount(); }); container.remove(); }
});


test("empty and active-only job lists do not offer clearing active work", async () => {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const state = { conformerJobs: [], xtbJobs: [], derivedColumnJobs: [], databaseJobs: [] };
  try {
    await act(async () => root.render(<JobsPanel state={state} actions={{} as ShellActions} />));
    expect(mount.querySelector('[role="status"]')?.textContent).toBe("No calculations yet");
    expect(mount.querySelector("button")).toBeNull();
    await act(async () => root.render(<JobsPanel state={{ ...state, xtbJobs: [{ id: "queue", title: "Optimize", operation: "optimize", status: "queued", inputLabel: "water.sdf", startedAt: 1 }] }} actions={{} as ShellActions} />));
    expect(mount.querySelector<HTMLButtonElement>(".jobs-panel-toolbar button")?.disabled).toBe(true);
    expect(mount.querySelector(".jobs-panel-status")?.textContent).toBe("Queued");
    expect(mount.querySelector(".jobs-panel-row-header .jobs-panel-actions button")).toBeNull();
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
