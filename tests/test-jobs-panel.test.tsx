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
    clearConformerJobs() { calls.push("clear-compute"); }, clearXtbJobs() { calls.push("clear-xtb"); }, clearDerivedColumnJobs() { calls.push("clear-columns"); }, clearDatabaseJobs() { calls.push("clear-database"); }, clearResourceJobs() { calls.push("clear-resources"); },
  } as unknown as ShellActions;
  const state = {
    resourceJobs: [],
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
    expect(calls.slice(2)).toEqual(["xtb", ["/failure.md"], ["/report.md"], ["/run.log"], "database-result", "clear-compute", "clear-xtb", "clear-columns", "clear-database", "clear-resources"]);
  } finally { await act(async () => { root.unmount(); }); container.remove(); }
});


test("empty and active-only job lists do not offer clearing active work", async () => {
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  const state = { conformerJobs: [], xtbJobs: [], derivedColumnJobs: [], databaseJobs: [], resourceJobs: [] };
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


test("resource jobs share ordering, progress, safe errors, cancellation and Extensions navigation", async () => {
  const { createAppShellViewState } = await import("../apps/desktop/src/hooks/use-app-shell-view-state");
  const { createAppShellActions } = await import("../apps/desktop/src/hooks/use-app-shell-actions");
  const { createResourceInstallRunner } = await import("../apps/desktop/src/lib/extensions/resource-install-runner");
  const runner = createResourceInstallRunner({ fetcher: async () => { throw new Error("https://private.example/token-secret"); },
    store: { getInstalled: async () => null } as never });
  const failure = await runner.installCrystals(), calls: unknown[] = [];
  const job = { operation: "install", title: "Install Crystals", status: "running", phase: "reading", cancelable: true,
    receivedBytes: 1024, totalBytes: 8192 } as const;
  const state = createAppShellViewState({ activeDocument: null, viewerLigandSelections: {}, structureStories: {},
    conformerJobs: [{ id: "compute", title: "Existing compute", status: "running", startedAt: 1 }],
    xtbJobs: [{ id: "xtb", title: "Existing xTB", status: "success", startedAt: 2 }],
    derivedColumnJobs: [{ id: "column", columnLabel: "Existing column", status: "success", startedAt: 3, processedRows: 3, failedRows: 0 }],
    databaseJobs: [{ id: "database", title: "Existing search", status: "success", startedAt: 4 }],
    resourceExtensions: { installed: null, initialized: true, error: null }, resourceJobs: [
      { ...job, id: "reading", startedAt: 10 }, { ...job, id: "installing", title: "Installing Crystals", phase: "installing", startedAt: 9 },
      { ...job, id: "removing", title: "Remove Crystals", operation: "remove", phase: "removing", startedAt: 8 },
      { ...job, id: "cancelling", title: "Cancelling Crystals", cancelable: false, startedAt: 7 },
      { ...job, id: "queued", title: "Queued Crystals", status: "queued", startedAt: 6 },
      { ...job, id: "done", title: "Installed Crystals", status: "success", cancelable: false, startedAt: 5 }, { ...failure, startedAt: 0 },
    ] } as never);
  const actions = createAppShellActions({ cancelResourceJob: id => calls.push(id), openSettingsSection: section => calls.push(section) } as unknown as ShellActions);
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<JobsPanel state={state} actions={actions} variant="page" />));
    const rows = [...mount.querySelectorAll("li")], row = (title: string) => rows.find(row => row.querySelector("strong")?.textContent === title)!;
    expect(rows.map(row => row.querySelector("strong")?.textContent)).toEqual(["Install Crystals", "Installing Crystals", "Remove Crystals", "Cancelling Crystals", "Queued Crystals", "Existing compute", "Installed Crystals", "Existing search", "Existing column", "Existing xTB", "Install Crystals"]);
    expect([row("Install Crystals"), row("Installing Crystals"), row("Remove Crystals"), row("Cancelling Crystals")].map(row => row.querySelector(".jobs-panel-status")?.textContent)).toEqual(["1,024 / 8,192 bytes", "Installing", "Removing", "Cancelling"]);
    for (const title of ["Install Crystals", "Installing Crystals", "Remove Crystals"]) {
      await act(async () => [...row(title).querySelectorAll("button")].find(button => button.textContent === "Cancel")!.click());
    }
    expect(calls).toEqual(["reading", "installing", "removing"]);
    expect([row("Cancelling Crystals"), row("Queued Crystals")].every(row => ![...row.querySelectorAll("button")].some(button => button.textContent === "Cancel"))).toBe(true);
    await act(async () => [...row("Installed Crystals").querySelectorAll("button")].find(button => button.textContent === "Open result")!.click());
    expect(calls.at(-1)).toBe("extensions");
    const failed = rows.at(-1)!;
    await act(async () => failed.querySelector<HTMLButtonElement>(".jobs-panel-toggle")!.click());
    await act(async () => [...failed.querySelectorAll("button")].find(button => button.textContent === "Details")!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Crystals could not be installed. Try again.");
    expect(document.body.textContent).not.toContain("token-secret");
    await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => [...mount.querySelectorAll("button")].find(button => button.textContent === "Active")!.click());
    expect(mount.querySelectorAll("li")).toHaveLength(6);
    const input = mount.querySelector<HTMLInputElement>('[aria-label="Search jobs"]')!;
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!; setter.call(input, "Remove Crystals"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect([...mount.querySelectorAll("li strong")].map(node => node.textContent)).toEqual(["Remove Crystals"]);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});

test("clearing finished resource jobs keeps an active download and its installed bundle", async () => {
  const { createResourceInstallRunner } = await import("../apps/desktop/src/lib/extensions/resource-install-runner");
  const installed = { catalog: { id: "crystals" }, files: [] }, calls: string[] = [];
  let fetches = 0;
  const runner = createResourceInstallRunner({ store: { getInstalled: async () => installed, remove: async () => { calls.push("remove-bundle"); } } as never,
    fetcher: async (_input, options) => {
      if (++fetches === 1) throw new Error("private failure");
      return new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
    } });
  await runner.refresh(); await runner.installCrystals();
  const pending = runner.installCrystals(); await Promise.resolve();
  const before = runner.getSnapshot(), running = before.jobs.find(job => job.status === "running")!;
  const state = { conformerJobs: [], xtbJobs: [], derivedColumnJobs: [], databaseJobs: [], resourceJobs: before.jobs };
  const actions = { clearConformerJobs() { calls.push("compute"); }, clearXtbJobs() { calls.push("xtb"); }, clearDerivedColumnJobs() { calls.push("columns"); }, clearDatabaseJobs() { calls.push("database"); }, clearResourceJobs: runner.clearFinished } as unknown as ShellActions;
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<JobsPanel state={state} actions={actions} />));
    await act(async () => [...mount.querySelectorAll("button")].find(button => button.textContent === "Clear finished")!.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Clear finished")!.click());
    expect(calls).toEqual(["compute", "xtb", "columns", "database"]);
    expect(runner.getSnapshot().jobs).toEqual([running]);
    expect(runner.getSnapshot().installed).toBe(installed);
  } finally { runner.cancel(running.id); await pending; await act(async () => root.unmount()); mount.remove(); }
});

test("asynchronous cancellation restores only owned focus, including a row leaving Active", async () => {
  const { createResourceInstallRunner } = await import("../apps/desktop/src/lib/extensions/resource-install-runner");
  for (const mode of ["details", "active", "moved", "unfocused", "delayed"]) {
    let releaseCleanup: (() => void) | undefined, startCancellation: (() => void) | undefined;
    const runner = createResourceInstallRunner({ store: { getInstalled: async () => null } as never,
      fetcher: async (_input, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => {
        releaseCleanup = () => reject(new DOMException("Cancelled", "AbortError"));
      }, { once: true })) });
    const pending = runner.installCrystals(); await Promise.resolve();
    const mount = document.createElement("div"), input = document.createElement("input");
    document.body.append(mount, input); const root = createRoot(mount);
    function Fixture() {
      const state = React.useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot);
      const actions = { cancelResourceJob: id => {
        if (mode === "delayed") startCancellation = () => runner.cancel(id);
        else runner.cancel(id);
      } } as ShellActions;
      return <JobsPanel variant="page" state={{ conformerJobs: [], xtbJobs: [], derivedColumnJobs: [], databaseJobs: [], resourceJobs: state.jobs }} actions={actions} />;
    }
    try {
      await act(async () => root.render(<Fixture />));
      if (mode === "active") await act(async () => [...mount.querySelectorAll("button")].find(button => button.textContent === "Active")!.click());
      const cancel = [...mount.querySelectorAll("button")].find(button => button.textContent === "Cancel")!;
      const details = mount.querySelector<HTMLButtonElement>(".jobs-panel-toggle")!;
      await act(async () => { if (mode === "unfocused") input.focus(); else cancel.focus(); cancel.click(); });
      if (mode === "unfocused") expect(document.activeElement).toBe(input);
      else if (mode === "delayed") {
        expect(document.activeElement).toBe(cancel);
        // A user focus move remains authoritative even if they subsequently blur.
        input.focus(); input.blur();
        await act(async () => startCancellation!());
        expect(document.activeElement).toBe(document.body);
      } else expect(document.activeElement).toBe(details);
      expect(mount.textContent).toContain("Cancelling");
      expect([...mount.querySelectorAll("button")].some(button => button.textContent === "Cancel")).toBe(false);
      if (mode === "moved") input.focus();
      await act(async () => { releaseCleanup!(); await pending; });
      expect(runner.getSnapshot().jobs[0].status).toBe("cancelled");
      if (mode === "active") {
        expect(mount.querySelectorAll("li")).toHaveLength(0);
        expect(document.activeElement).toBe(mount.querySelector(".jobs-panel"));
      } else {
        expect(mount.textContent).toContain("Cancelled");
        expect(document.activeElement).toBe(mode === "moved" || mode === "unfocused" ? input : mode === "delayed" ? document.body : details);
      }
    } finally {
      await act(async () => { runner.cancel(runner.getSnapshot().jobs[0].id); releaseCleanup?.(); await pending; root.unmount(); });
      mount.remove(); input.remove();
    }
  }
});
