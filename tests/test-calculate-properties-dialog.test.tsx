import { expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { PROPERTY_GROUPS } from "../apps/desktop/src/lib/derived-column-compute.mjs";
import type { DescriptorRuntimeStatus } from "../apps/desktop/src/lib/descriptors";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const available: DescriptorRuntimeStatus = { available: true, installerAvailable: true, installPhase: "completed", installSizeHint: "100 MB", message: "engine /private/python", installHint: "internal", rdkitVersion: "test", mordredVersion: "test" };
let readStatus: () => Promise<DescriptorRuntimeStatus>;
let install: () => Promise<void>;
let cancel: () => Promise<void>;
mock.module("../apps/desktop/src/lib/derived-columns", () => ({ PROPERTY_GROUPS }));
mock.module("../apps/desktop/src/lib/descriptors", () => ({
  descriptorRuntimeStatus: () => readStatus(), installDescriptorRuntime: () => install(), cancelDescriptorRuntimeInstall: () => cancel(),
}));
const { createRoot } = await import("react-dom/client");
const { CalculatePropertiesDialog } = await import("../apps/desktop/src/components/calculate-properties-dialog");
const request = { documentId: "series", documentTitle: "Series" };
async function fixture(run: (mount: HTMLDivElement, calls: unknown[][], render: (open: boolean) => Promise<void>) => Promise<void>) {
  readStatus = async () => available; install = cancel = async () => {};
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount);
  const root = createRoot(mount); const calls: unknown[][] = [];
  const render = (open: boolean) => act(async () => root.render(<CalculatePropertiesDialog request={open ? request : null}
    onDismiss={() => calls.push(["close"])} onRun={(...args) => calls.push(args)} />));
  try { await render(true); await run(mount, calls, render); }
  finally { await act(async () => root.unmount()); mount.remove(); mock.restore(); }
}
const button = (mount: Element, name: string) => Array.from(mount.querySelectorAll("button")).find(el => el.textContent === name)!;
const checkbox = (mount: Element, name: string) => Array.from(mount.querySelectorAll("label")).find(el => el.textContent === name)!.querySelector<HTMLButtonElement>('[role="checkbox"]')!;

test("property selection retains the exact defaults and options across opens but resets the extended pass", async () => {
  await fixture(async (mount, calls, render) => {
    await act(async () => button(mount, "Calculate").click());
    expect(calls).toEqual([["series", ["cLogP", "cLogS", "HAcceptors", "HDonors", "TPSA", "RotatableBonds", "MolWeight"], { largestFragment: true, mordred: false }], ["close"]]);
    calls.length = 0;
    await act(async () => { checkbox(mount, "cLogP").click(); checkbox(mount, "All 2D descriptors (~1,600 columns)").click(); checkbox(mount, "Use largest fragment (strip salts and solvents)").click(); });
    await render(false); await render(true);
    expect([checkbox(mount, "cLogP").getAttribute("aria-checked"), checkbox(mount, "All 2D descriptors (~1,600 columns)").getAttribute("aria-checked"), checkbox(mount, "Use largest fragment (strip salts and solvents)").getAttribute("aria-checked")]).toEqual(["false", "false", "false"]);
    await act(async () => button(mount, "Cancel").click()); expect(calls).toEqual([["close"]]);
    expect(mount.textContent).not.toMatch(/openchemlib|RDKit|Mordred|\/private/);
  });
});

test("group toggles select all or none and an empty selection cannot start a calculation", async () => {
  await fixture(async (mount, calls) => {
    for (const name of ["Druglikeness", "Toxicity risks", "Counts and rings"]) {
      await act(async () => button(mount, name).click());
      expect(button(mount, name).getAttribute("aria-pressed")).toBe("true");
      await act(async () => button(mount, name).click());
    }
    expect(button(mount, "Calculate").disabled).toBe(true);
    await act(async () => button(mount, "Calculate").click()); expect(calls).toEqual([]);
    await act(async () => checkbox(mount, "All 2D descriptors (~1,600 columns)").click());
    await act(async () => button(mount, "Calculate").click());
    expect(calls).toEqual([["series", [], { largestFragment: true, mordred: true }], ["close"]]);
  });
});

test("installation reports progress, cancellation failures and recovery without exposing logs", async () => {
  await fixture(async (mount, _calls, render) => {
    spyOn(console, "error").mockImplementation(() => {});
    let poll!: () => void; let starts = 0;
    spyOn(window, "setInterval").mockImplementation(callback => { poll = callback as () => void; return 12345; });
    let status: DescriptorRuntimeStatus = { ...available, available: false, installPhase: "idle" };
    readStatus = async () => status;
    install = async () => { starts++; };
    cancel = async () => { throw new Error("cancel /private/runtime"); };
    await render(false); await render(true);
    await act(async () => button(mount, "Install (100 MB)").click());
    expect(mount.textContent).toContain("Installing…");
    await act(async () => button(mount, "Cancel installation").click());
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Could not cancel installation. Try again.");
    status = { ...status, installPhase: "cancelled" };
    await act(async () => poll());
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Installation cancelled.");
    await act(async () => button(mount, "Install (100 MB)").click());
    status = { ...status, installPhase: "failed", installError: "internal /private/build" };
    await act(async () => poll());
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Installation failed. Try again.");
    await act(async () => button(mount, "Install (100 MB)").click());
    status = available; await act(async () => poll());
    expect([starts, mount.textContent?.includes("Ready"), mount.querySelector('[role="alert"]')]).toEqual([3, true, null]);
    expect(mount.textContent).not.toMatch(/\/private|RDKit|internal/);
  });
});

test("availability errors do not expose internal details or prevent basic calculations", async () => {
  await fixture(async (mount, _calls, render) => {
    spyOn(console, "error").mockImplementation(() => {});
    readStatus = async () => { throw new Error("runtime /private/install"); };
    await render(false); await render(true);
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Could not check availability. Reopen this dialog to try again.");
    expect([button(mount, "Calculate").disabled, mount.textContent?.includes("/private")]).toEqual([false, false]);
  });
});

test("a late status response after close cannot overwrite the reopened status", async () => {
  await fixture(async (mount, _calls, render) => {
    let finish!: (status: DescriptorRuntimeStatus) => void;
    readStatus = () => new Promise(resolve => { finish = resolve; });
    await render(false); await render(true);
    expect(mount.textContent).toContain("Checking…");
    await render(false); readStatus = async () => available; await render(true);
    await act(async () => finish({ ...available, available: false, installPhase: "installing" }));
    expect(mount.textContent).toContain("Ready");
    expect(mount.textContent).not.toContain("Installing…");
  });
});
