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
