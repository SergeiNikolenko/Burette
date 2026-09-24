import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : (browser as any)[key] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { JobsPanel } = await import("../apps/desktop/src/components/jobs-panel");

test("mixed jobs use one ordered list, keep error details collapsed and preserve actions", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const calls: unknown[] = [];
  const actions = {
    cancelConformerJob: (id: string) => calls.push(id), openPaths: (paths: string[]) => calls.push(paths),
    cancelXtbJob: (id: string) => calls.push(id), openTextPaths: (paths: string[]) => calls.push(paths),
    clearConformerJobs() { calls.push("clear-compute"); }, clearXtbJobs() { calls.push("clear-xtb"); }, clearDerivedColumnJobs() { calls.push("clear-columns"); }, clearDatabaseJobs() { calls.push("clear-database"); },
  } as unknown as ShellActions;
  const state = {
    conformerJobs: [
      {id:"old",title:"Failed energy",status:"failed",startedAt:1,inputTitle:"a.sdf",error:"Full technical error",reportPath:"/failure.md"},
      {id:"active",title:"Alignment",status:"running",startedAt:2,inputTitle:"b.sdf",cancelable:true},
      {id:"done",title:"MMFF",status:"success",startedAt:3,inputTitle:"b.sdf",primaryOpenPath:"/result.sdf",reportPath:"/report.md",logPath:"/run.log"},
    ], xtbJobs: [{id:"xtb",title:"xTB",status:"running",startedAt:0,inputLabel:"water.sdf"}], databaseJobs: [],
    derivedColumnJobs: [{id:"scaffold",columnLabel:"Scaffolds",documentTitle:"series.csv",status:"success",startedAt:4,processedRows:8,failedRows:1,totalRows:8}],
  } as unknown as ShellViewState;
  await act(async () => { root.render(<JobsPanel state={state} actions={actions} />); });
  expect([...container.querySelectorAll("li strong")].map(node => node.textContent)).toEqual(["Alignment", "xTB", "Scaffolds", "MMFF", "Failed energy"]);
  expect([...container.querySelectorAll("details")].every(details => !details.open)).toBe(true);
  expect([...container.querySelectorAll("li > p")]).toHaveLength(0);
  expect([...container.querySelectorAll("summary")].map(node => node.textContent)).toEqual(["AlignmentRunning", "xTBRunning", "ScaffoldsPartial", "MMFFDone", "Failed energyFailed"]);
  expect(container.querySelector("details pre")?.textContent).toBe("Full technical error");
  expect(container.textContent).toContain("Partial");
  expect(container.textContent).not.toContain("No xTB");
  for (const label of ["Cancel", "Open result"]) {
    await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click(); });
  }
  expect(calls).toEqual(["active", ["/result.sdf"]]);
  const rows = [...container.querySelectorAll("li")];
  for (const title of ["xTB", "Failed energy", "MMFF"]) {
    const row = rows.find(row => row.querySelector("strong")?.textContent === title)!;
    if (title === "MMFF") row.querySelector("details")!.open = true;
    const labels = title === "xTB" ? ["Cancel"] : title === "MMFF" ? ["Report", "Log"] : ["Report"];
    for (const label of labels) await act(async () => { [...row.querySelectorAll("button")].find(button=>button.textContent===label)!.click(); });
  }
  await act(async () => { [...container.querySelectorAll("button")].find(button=>button.textContent==="Clear finished")!.click(); });
  expect(calls.slice(2)).toEqual(["xtb", ["/failure.md"], ["/report.md"], ["/run.log"], "clear-compute", "clear-xtb", "clear-columns", "clear-database"]);
  await act(async () => { root.unmount(); }); container.remove();
});
