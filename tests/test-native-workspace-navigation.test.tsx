import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { NativeWorkspaceSidebar } = await import("../apps/desktop/src/components/native-workspace-navigation");

test("Home reuses its page and keeps open structures available", async () => {
  const calls: string[] = [];
  const structure = { id: "protein", location: { kind: "file", path: "/samples/1htb.pdb" } };
  const home = { id: "home", location: { kind: "launcher" } };
  const state = { tabs: [structure, home], activeTab: structure, activeTabId: "protein", documents: [{ id: "protein", path: "/samples/1htb.pdb", title: "1htb.pdb" }] } as unknown as ShellViewState;
  const actions = {
    selectTab: (id: string) => calls.push(id), openNewTab: () => calls.push("new"), openKetcher: () => calls.push("ketcher"),
  } as unknown as ShellActions;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async () => { await act(async () => root.render(<NativeWorkspaceSidebar state={state} actions={actions} />)); };
  const click = async (name: string) => {
    const button = [...container.querySelectorAll("button")].find(button => button.textContent === name);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  try {
    await render();
    await click("Home");
    await click("1htb.pdb");
    await click("Draw a molecule");
    expect(calls).toEqual(["home", "protein", "ketcher"]);
    expect(state.tabs).toHaveLength(2);
    state.tabs = state.tabs.filter(tab => tab.id !== "home");
    await render();
    await click("Home");
    expect(calls).toEqual(["home", "protein", "ketcher", "new"]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
