import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useState } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "DocumentFragment", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { NativeSelect, NativeSelectOption, NativeSelectOptGroup } = await import("../apps/desktop/src/components/ui/native-select");

test("browser choices use a Radix listbox and keep labels, disabled groups, empty values and form change contracts", async () => {
  const calls: unknown[] = [];
  function Form() {
    const [value, setValue] = useState("");
    return <form><label htmlFor="choice">Method</label><span id="hint">Choose a method</span>
      <NativeSelect id="choice" name="method" aria-describedby="hint" value={value} onChange={event => {
        calls.push([event.currentTarget.name, event.currentTarget.value, event.target === event.currentTarget]);
        setValue(event.target.value);
      }}>
        <NativeSelectOption value="">Automatic</NativeSelectOption>
        <NativeSelectOptGroup label="Available"><NativeSelectOption value={2}>Second</NativeSelectOption></NativeSelectOptGroup>
        <NativeSelectOptGroup label="Unavailable" disabled><NativeSelectOption value="blocked">Blocked</NativeSelectOption></NativeSelectOptGroup>
      </NativeSelect>
    </form>;
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<Form />));
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    expect([trigger.tagName, trigger.id, trigger.textContent, trigger.getAttribute("aria-describedby")]).toEqual(["BUTTON", "choice", "Automatic", "hint"]);
    expect(host.querySelector("select")!.hidden).toBe(true);
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options.map(option => [option.textContent, option.getAttribute("aria-disabled")])).toEqual([["Automatic", null], ["Second", null], ["Blocked", "true"]]);
    await act(async () => options[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(calls).toEqual([["method", "2", true]]);
    expect(trigger.textContent).toBe("Second");
    expect(new browser.FormData(host.querySelector("form")!).get("method")).toBe("2");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const selected = document.querySelector<HTMLElement>('[role="option"][data-state="checked"]')!;
    expect(selected.textContent).toBe("Second");
    await act(async () => selected.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    // Radix restores focus in the deferred FocusScope unmount cleanup.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.activeElement?.id).toBe(trigger.id);
    expect(calls).toEqual([["method", "2", true]]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("Tauri retains the native select and exact option values", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<NativeSelect id="native" defaultValue="b" aria-label="Native method"><option value="a">First</option><option value="b">Second</option></NativeSelect>));
    const select = host.querySelector("select")!;
    expect([select.id, select.hidden, select.value]).toEqual(["native", false, "b"]);
    expect(host.querySelector('button[role="combobox"]')).toBeNull();
    await act(async () => {
      select.value = "a";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.value).toBe("a");
  } finally { await act(async () => root.unmount()); host.remove(); Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); }
});
