import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useState } from "react";

const browser = new Window();
for (const key of ["HTMLFormElement", "DocumentFragment"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "getComputedStyle", "CustomEvent", "FocusEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { TrajectorySetting } = await import("../apps/desktop/src/components/trajectory-setting");
const { NativeSelect, NativeSelectOption } = await import("../apps/desktop/src/components/ui/native-select");
const { Checkbox } = await import("../apps/desktop/src/components/ui/checkbox");
const { TooltipProvider } = await import("../apps/desktop/src/components/ui/tooltip");

test("scientific hints describe controls without entering their labels or blocking changes", async () => {
  const calls: unknown[] = [];
  function Fields() {
    const [signal, setSignal] = useState("rmsd");
    return <TooltipProvider delayDuration={0}>
      <TrajectorySetting hint={signal === "rmsd" ? "Measured displacement" : "Slow motion"}>
        <span>Signal</span>
        <NativeSelect aria-label="Signal" aria-describedby="existing" value={signal} onChange={event => { setSignal(event.target.value); calls.push(event.target.value); }}>
          <NativeSelectOption value="rmsd">RMSD</NativeSelectOption><NativeSelectOption value="ic1">tICA</NativeSelectOption>
        </NativeSelect>
      </TrajectorySetting>
      <span id="existing" hidden>Choose a signal</span>
      <TrajectorySetting hint="Keep trajectory endpoints"><Checkbox aria-label="Include endpoints" defaultChecked onCheckedChange={value => calls.push(value)} /><span>Include endpoints</span></TrajectorySetting>
    </TooltipProvider>;
  }
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(<Fields />));
    const select = mount.querySelector("select")!;
    const descriptions = () => select.getAttribute("aria-describedby")!.split(" ").map(id => document.getElementById(id)?.textContent);
    expect(descriptions()).toEqual(["Choose a signal", "Measured displacement"]);
    const trigger = mount.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect(trigger.textContent).toBe("RMSD");
    expect(trigger.getAttribute("aria-describedby")).toBe(select.getAttribute("aria-describedby"));
    expect(mount.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    await act(async () => { select.value = "ic1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(descriptions()).toEqual(["Choose a signal", "Slow motion"]);
    const checkbox = mount.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    expect(document.getElementById(checkbox.getAttribute("aria-describedby")!)?.textContent).toBe("Keep trajectory endpoints");
    await act(async () => checkbox.click());
    expect(calls).toEqual(["ic1", false]);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
