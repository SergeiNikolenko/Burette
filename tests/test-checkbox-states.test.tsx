import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useState } from "react";
const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Node", "NodeFilter", "CustomEvent", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Checkbox } = await import("../apps/desktop/src/components/ui/checkbox");
const { Switch } = await import("../apps/desktop/src/components/ui/switch");
const { RadioGroup, RadioGroupItem } = await import("../apps/desktop/src/components/ui/radio-group");
const { DeleteColumnsDialog } = await import("../apps/desktop/src/components/delete-columns-dialog");

test("mixed checkbox activates all, then clears, while disabled stays unchanged", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const changes: unknown[] = [];
  function Controls() {
    const [checked, setChecked] = useState<boolean | "indeterminate">("indeterminate");
    return <><label><Checkbox checked={checked} onCheckedChange={value => { changes.push(value); setChecked(value); }} />All columns</label>
      <Checkbox disabled defaultChecked aria-label="Locked" onCheckedChange={value => changes.push(value)} /></>;
  }
  try {
    await act(async () => root.render(<Controls />));
    const boxes = container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    expect(boxes[0]!.getAttribute("aria-checked")).toBe("mixed");
    await act(async () => boxes[0]!.click());
    expect(boxes[0]!.getAttribute("aria-checked")).toBe("true");
    await act(async () => { boxes[0]!.click(); boxes[1]!.click(); });
    expect(changes).toEqual([true, false]);
    expect(boxes[1]!.getAttribute("aria-checked")).toBe("true");
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("column dialog submits exactly the selected column through shared checkbox", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const calls: unknown[] = [];
  const request = { documentId: "molecules", documentTitle: "Series", columns: [{ id: "mass", label: "Mass" }, { id: "logp", label: "LogP" }] };
  try {
    await act(async () => root.render(<DeleteColumnsDialog request={request} onDismiss={() => {}} onRun={(...args) => calls.push(args)} />));
    const dialog = document.querySelector('[role="dialog"]')!;
    const boxes = dialog.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    await act(async () => boxes[1]!.click());
    const submit = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === "Delete")!;
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(calls).toEqual([["molecules", ["logp"]]]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("switch and radio labels activate their controls without activating disabled choices", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const changes: unknown[] = [];
  try {
    await act(async () => root.render(<>
      <label><Switch tone="neutral" size="sm" onCheckedChange={value => changes.push(value)} />Align</label>
      <RadioGroup defaultValue="atoms" onValueChange={value => changes.push(value)}>
        <RadioGroupItem value="atoms">Atoms</RadioGroupItem>
        <RadioGroupItem value="residues">Residues</RadioGroupItem>
        <RadioGroupItem value="chains" disabled>Chains</RadioGroupItem>
      </RadioGroup>
    </>));
    const labels = container.querySelectorAll<HTMLLabelElement>("label");
    await act(async () => { labels[0]!.click(); labels[2]!.click(); labels[3]!.click(); });
    expect(changes).toEqual([true, "residues"]);
    expect(Array.from(container.querySelectorAll('[role="radio"]'), item => item.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(container.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("true");
  } finally { await act(async () => root.unmount()); container.remove(); }
});
