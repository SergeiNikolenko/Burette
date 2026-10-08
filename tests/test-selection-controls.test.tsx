import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, createRef } from "react";

const browser = new Window();
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: browser.ResizeObserver });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "DocumentFragment", "Node", "NodeFilter", "CustomEvent", "Event", "MouseEvent", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Checkbox } = await import("../apps/desktop/src/components/ui/checkbox");
const { RadioGroup, RadioGroupItem } = await import("../apps/desktop/src/components/ui/radio-group");
const { Switch } = await import("../apps/desktop/src/components/ui/switch");
const { SegmentedControl, SegmentedControlItem } = await import("../apps/desktop/src/components/ui/segmented-control");

test("segmented selection cannot be cleared, skips disabled options, and never submits its form", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const changes: string[] = [];
  let submissions = 0;
  function Example({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = React.useState("gfn2");
    return <form onSubmit={event => { event.preventDefault(); submissions++; }}>
      <SegmentedControl aria-label="Method" value={value} disabled={disabled} onValueChange={next => { changes.push(next); setValue(next); }}>
        <SegmentedControlItem value="gfn2">GFN2</SegmentedControlItem>
        <SegmentedControlItem value="gfn1" disabled>GFN1</SegmentedControlItem>
        <SegmentedControlItem value="gfn0">GFN0</SegmentedControlItem>
      </SegmentedControl>
    </form>;
  }
  try {
    await act(async () => root.render(<Example />));
    const items = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    await act(async () => { items[0].click(); items[1].click(); });
    expect(changes).toEqual([]);
    await act(async () => {
      items[0].focus();
      items[0].dispatchEvent(new browser.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(items[2]);
    await act(async () => items[2].click());
    expect(items.map(item => item.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    expect(changes).toEqual(["gfn0"]);
    expect(submissions).toBe(0);
    await act(async () => root.render(<Example disabled />));
    expect(items.every(item => item.disabled)).toBe(true);
    await act(async () => items[0].click());
    expect(changes).toEqual(["gfn0"]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("checkbox preserves mixed-state transition, form value, ref and disabled behavior", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<HTMLButtonElement>();
  const changes: unknown[] = [];
  try {
    await act(async () => root.render(<form>
      <label><Checkbox ref={ref} name="selection" value="atoms" defaultChecked="indeterminate" onCheckedChange={value => changes.push(value)} />Atoms</label>
      <Checkbox disabled aria-label="Locked" onCheckedChange={() => changes.push("locked")} />
    </form>));
    expect(ref.current!.getAttribute("aria-checked")).toBe("mixed");
    await act(async () => ref.current!.click());
    expect(ref.current!.getAttribute("aria-checked")).toBe("true");
    const form = container.querySelector("form")!;
    expect([...new browser.FormData(form as never).entries()]).toEqual([["selection", "atoms"]]);
    await act(async () => {
      ref.current!.click();
      container.querySelector<HTMLButtonElement>('[aria-label="Locked"]')!.click();
    });
    expect([...new browser.FormData(form as never).entries()]).toEqual([]);
    expect(changes).toEqual([true, false]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("radio selection submits one value and group disabled state reaches every item", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const changes: string[] = [];
  const view = (disabled: boolean) => <form>
    <RadioGroup name="mode" defaultValue="atoms" disabled={disabled} onValueChange={value => changes.push(value)}>
      <RadioGroupItem value="atoms">Atoms</RadioGroupItem>
      <RadioGroupItem value="residues">Residues</RadioGroupItem>
      <RadioGroupItem value="chains" disabled>Chains</RadioGroupItem>
    </RadioGroup>
  </form>;
  try {
    await act(async () => root.render(view(false)));
    const items = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    await act(async () => { items[1].click(); items[2].click(); });
    expect(changes).toEqual(["residues"]);
    expect([...new browser.FormData(container.querySelector("form")! as never).entries()]).toEqual([["mode", "residues"]]);
    await act(async () => root.render(view(true)));
    expect(items.map(item => [item.disabled, item.closest("label")!.hasAttribute("data-disabled")])).toEqual([[true, true], [true, true], [true, true]]);
    await act(async () => items[0].click());
    expect(changes).toEqual(["residues"]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("switch toggles its form value and disabled switches never dispatch changes", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const changes: boolean[] = [];
  try {
    await act(async () => root.render(<form>
      <Switch name="enabled" defaultChecked onCheckedChange={value => changes.push(value)} aria-label="Enabled" />
      <Switch disabled onCheckedChange={value => changes.push(value)} aria-label="Locked" />
    </form>));
    const switches = [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
    await act(async () => { switches[0].click(); switches[1].click(); });
    expect(changes).toEqual([false]);
    expect([...new browser.FormData(container.querySelector("form")! as never).entries()]).toEqual([]);
    await act(async () => switches[0].click());
    expect(changes).toEqual([false, true]);
    expect([...new browser.FormData(container.querySelector("form")! as never).entries()]).toEqual([["enabled", "on"]]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
