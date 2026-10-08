import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { InspectorToolRow } = await import("../apps/desktop/src/components/inspector-tool-row");
type Props = React.ComponentProps<typeof InspectorToolRow>;
async function fixture(run: (mount: HTMLDivElement, calls: string[], render: (patch?: Partial<Props>, key?: string) => Promise<void>) => Promise<void>) {
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount); const root = createRoot(mount);
  const calls: string[] = [];
  const props: Props = { name: "Molecular calculations", detail: "GFN2 · gas phase", detailTitle: "GFN2, normal convergence, charge 0, gas phase", state: "ready", primaryLabel: "Optimize", inputLabel: "Series.sdf", runLabel: "Properties", onPrimary: () => calls.push("optimize"), onRun: () => calls.push("properties"), onHistory: () => calls.push("history"), children: <label>Charge<input aria-label="Charge" type="number" defaultValue={0} /></label> };
  try { await run(mount, calls, (patch = {}, key = "series") => act(async () => root.render(<InspectorToolRow key={key} {...props} {...patch} />))); }
  finally { await act(async () => root.unmount()); mount.remove(); }
}
const button = (mount: Element, name: string) => Array.from(mount.querySelectorAll("button")).find(el => el.textContent === name)!;
const settings = (mount: Element) => mount.querySelector<HTMLButtonElement>('[aria-label="Molecular calculations settings"]')!;
const click = (el: HTMLElement) => act(async () => el.click());

test("tool rows expose settings without dispatching jobs and preserve separate quick/selected actions", async () => {
  await fixture(async (mount, calls, render) => {
    await render();
    expect(mount.textContent).toBe("Molecular calculationsOptimize");
    expect(settings(mount).getAttribute("aria-description")).toContain("normal convergence");
    await click(button(mount, "Optimize")); expect(calls).toEqual(["optimize"]);
    await click(settings(mount)); expect(calls).toEqual(["optimize"]);
    const dialog = mount.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Series.sdf"); expect(dialog.querySelector('input[aria-label="Charge"]')).not.toBeNull();
    await click(button(dialog, "Properties")); expect(calls).toEqual(["optimize", "properties"]);
    expect(mount.querySelector('[role="dialog"]')).toBeNull();
    await click(settings(mount)); await click(button(mount.querySelector('[role="dialog"]')!, "Run history"));
    expect(calls).toEqual(["optimize", "properties", "history"]); expect(mount.querySelector('[role="dialog"]')).toBeNull();
  });
});

test("unavailable operations stay disabled in the row and dialog while their reason and settings remain accessible", async () => {
  await fixture(async (mount, calls, render) => {
    await render({ primaryDisabled: true, detail: "Selection exceeds 300 atoms", detailTitle: undefined });
    expect(mount.textContent).toContain("Selection exceeds 300 atoms");
    await click(button(mount, "Optimize")); await click(settings(mount));
    expect(button(mount.querySelector('[role="dialog"]')!, "Properties").disabled).toBe(true);
    await click(button(mount.querySelector('[role="dialog"]')!, "Properties")); expect(calls).toEqual([]);
    await click(button(mount, "Done")); expect(mount.querySelector('[role="dialog"]')).toBeNull();
  });
});

test("running status is announced, Escape does not run a job, and a document change closes old settings", async () => {
  await fixture(async (mount, calls, render) => {
    await render({ state: "running" }); expect(mount.querySelector('[role="status"]')?.textContent).toBe("Running");
    await click(settings(mount));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(mount.querySelector('[role="dialog"]')).toBeNull(); expect(calls).toEqual([]);
    await click(settings(mount)); await render({ inputLabel: "Other.sdf" }, "other");
    expect(mount.querySelector('[role="dialog"]')).toBeNull(); expect(calls).toEqual([]);
  });
});
