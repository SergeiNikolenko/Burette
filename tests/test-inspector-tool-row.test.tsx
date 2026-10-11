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
const { CollapsibleSection } = await import("../apps/desktop/src/components/ui/collapsible-section");
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

test("inspector disclosure preserves edited fields across collapse and controlled updates", async () => {
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  const changes: boolean[] = [];
  function Example({ forced }: { forced?: boolean }) {
    return <CollapsibleSection title="Tools" detail="2" open={forced} onOpenChange={open => changes.push(open)}>
      <input aria-label="Charge" defaultValue="0" />
    </CollapsibleSection>;
  }
  const toggle = async (open: boolean) => act(async () => {
    const section = mount.querySelector("details")!;
    section.open = open;
  });
  try {
    await act(async () => root.render(<Example />));
    const input = mount.querySelector("input")!;
    input.value = "2";
    await toggle(false);
    expect(mount.querySelector("details")!.open).toBe(false);
    await toggle(true);
    expect(mount.querySelector("input")).toBe(input);
    expect(input.value).toBe("2");
    expect(changes).toEqual([false, true]);
    await act(async () => root.render(<Example forced={false} />));
    expect(changes).toEqual([false, true]); // A parent update is not a user toggle.
    expect(mount.querySelector("details")!.open).toBe(false);
    await toggle(true);
    expect(changes).toEqual([false, true, true]);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});

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

test("nested inspector disclosures retain values without changing their parent state", async () => {
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  const changes: string[] = [];
  try {
    await act(async () => root.render(
      <CollapsibleSection title="Smooth motion" onOpenChange={open => changes.push(`outer:${open}`)}>
        <CollapsibleSection title="Scientific settings" onOpenChange={open => changes.push(`inner:${open}`)}>
          <input aria-label="Filter order" defaultValue="5" />
        </CollapsibleSection>
      </CollapsibleSection>
    ));
    const [outer, inner] = mount.querySelectorAll("details");
    const field = mount.querySelector("input")!;
    field.value = "7";
    await act(async () => { inner!.open = false; });
    expect(outer!.open).toBe(true);
    await act(async () => { outer!.open = false; });
    await act(async () => { outer!.open = true; });
    expect(inner!.open).toBe(false);
    await act(async () => { inner!.open = true; });
    expect(mount.querySelector("input")).toBe(field);
    expect(field.value).toBe("7");
    expect(changes).toEqual(["inner:false", "outer:false", "outer:true", "inner:true"]);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});

test("unavailable operations stay disabled in the row and dialog while their reason and settings remain accessible", async () => {
  await fixture(async (mount, calls, render) => {
    await render({ primaryDisabled: true, detail: "Selection exceeds 300 atoms", detailTitle: undefined });
    expect(mount.textContent).not.toContain("Selection exceeds 300 atoms");
    expect(settings(mount).getAttribute("aria-description")).toBe("Selection exceeds 300 atoms");
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
