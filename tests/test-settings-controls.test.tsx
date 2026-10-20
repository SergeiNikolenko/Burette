import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useState } from "react";

const browser = new Window();
Object.defineProperty(globalThis, "DocumentFragment", { configurable: true, value: browser.DocumentFragment });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { SettingsSection, ToggleControl, SettingsActionButton, SelectControl } = await import("../apps/desktop/src/components/settings-panel/setting-control");
const flushFocus = () => new Promise(resolve => setTimeout(resolve, 0));
const findButton = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === label)!;

test("settings keep named groups, switch/reset semantics, and guarded actions through shared controls", async () => {
  let actions = 0;
  const changes: unknown[] = [];
  function Settings() {
    const [enabled, setEnabled] = useState(true);
    const [mode, setMode] = useState("system");
    return <SettingsSection title="Preferences" rows={[
      { label: "Sound", description: "On completion", control: <ToggleControl label="Sound" checked={enabled} onChange={value => { changes.push(value); setEnabled(value); }} />, reset: () => setEnabled(true), isModified: !enabled },
      { label: "Theme", control: <SelectControl label="Theme" value={mode} options={["system", "dark"]} onChange={value => { changes.push(value); setMode(value); }} /> },
      { label: "Workspace", control: <SettingsActionButton confirm label="Reset workspace" dialogTitle="Reset workspace?" onClick={() => actions++}>Reset workspace</SettingsActionButton> },
    ]} />;
  }
  const shell = document.createElement("div"); shell.className = "app-shell"; document.body.append(shell);
  const root = createRoot(shell);
  try {
    await act(async () => root.render(<Settings />));
    const groups = Array.from(shell.querySelectorAll('[role="group"]'));
    expect(groups.map(group => document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent)).toEqual(["Sound", "Theme", "Workspace"]);
    expect(document.getElementById(groups[0].getAttribute("aria-describedby")!)?.textContent).toBe("On completion");
    expect(groups[1].hasAttribute("aria-describedby")).toBe(false);
    const toggle = shell.querySelector<HTMLButtonElement>('[role="switch"]')!;
    const reset = findButton("Reset");
    expect([toggle.getAttribute("aria-checked"), reset.disabled, reset.tabIndex]).toEqual(["true", true, -1]);
    await act(async () => toggle.click());
    expect([toggle.getAttribute("aria-checked"), reset.disabled, reset.tabIndex]).toEqual(["false", false, 0]);
    await act(async () => reset.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    const select = shell.querySelector<HTMLButtonElement>('button[aria-label="Theme"]')!;
    await act(async () => select.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(flushFocus);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    expect(options.map(option => [option.textContent, option.getAttribute("aria-checked")])).toEqual([["system", "true"], ["dark", "false"]]);
    await act(async () => options[1].click());
    await act(flushFocus);
    expect(changes).toEqual([false, "dark"]);
    expect([select.textContent, select.getAttribute("aria-expanded")]).toEqual(["dark", "false"]);
    expect(document.activeElement).toBe(select);
    await act(async () => select.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(flushFocus);
    const selected = document.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')!;
    expect(selected.textContent).toBe("dark");
    await act(async () => selected.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(flushFocus);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(changes).toEqual([false, "dark"]);
    const action = findButton("Reset workspace");
    await act(async () => action.click()); await act(flushFocus);
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => findButton("Cancel").click()); await act(flushFocus);
    expect(actions).toBe(0); expect(document.activeElement).toBe(action);
    await act(async () => action.click());
    await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-action"]')!.click());
    expect(actions).toBe(1);
  } finally { await act(async () => root.unmount()); shell.remove(); }
});
