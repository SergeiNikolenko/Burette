import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act, useState } from "react";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { SettingsSidebar } = await import("../apps/desktop/src/components/sidebar/settings-sidebar");
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
import type { SettingsSectionId } from "../apps/desktop/src/lib/settings-sections";

test("settings navigation filters metadata, retains selection, and exposes clear/back actions", async () => {
  const changes: string[] = [];
  let backs = 0;
  function Sidebar() {
    const [section, setSection] = useState<SettingsSectionId>("general");
    const state = { activeTab: { location: { kind: "settings", section } } } as ShellViewState;
    const actions = { backToApp: () => backs++, openSettingsSection: (next: SettingsSectionId) => { changes.push(next); setSection(next); } } as ShellActions;
    return <SettingsSidebar state={state} actions={actions} />;
  }
  const shell = document.createElement("div"); document.body.append(shell);
  const root = createRoot(shell);
  try {
    await act(async () => root.render(<Sidebar />));
    const nav = shell.querySelector('nav[aria-label="Settings"]')!;
    const input = nav.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!;
    const buttons = () => Array.from(nav.querySelectorAll<HTMLButtonElement>(".settings-nav-item"));
    const names = () => buttons().map(button => button.textContent);
    const initial = names();
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe("General");
    const fill = async (value: string) => { await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }); };
    await fill("  THEME  "); expect(names()).toEqual(["Appearance"]);
    expect(nav.querySelector('[aria-current="page"]')).toBeNull();
    await act(async () => buttons()[0].click());
    expect(changes).toEqual(["appearance"]);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe("Appearance");
    await fill("remote"); expect(names()).toEqual(["Connections"]);
    await fill("no-such-setting"); expect(names()).toEqual([]);
    expect(nav.querySelector('[role="status"]')?.textContent).toBe("No matching settings");
    await act(async () => nav.querySelector<HTMLButtonElement>('button[aria-label="Clear settings search"]')!.click());
    expect(names()).toEqual(initial); expect(input.value).toBe(""); expect(document.activeElement).toBe(input);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe("Appearance");
    expect(nav.querySelector('[role="status"]')).toBeNull();
    await act(async () => Array.from(nav.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Back to app")!.click());
    expect(backs).toBe(1);
  } finally { await act(async () => root.unmount()); shell.remove(); }
});
