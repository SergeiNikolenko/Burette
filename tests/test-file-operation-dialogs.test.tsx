import { expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ShellActions, ShellViewState } from "../apps/desktop/src/components/types";
import type { MenuItemSpec } from "../apps/desktop/src/components/menu-types";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "SVGElement", "HTMLInputElement", "Element", "Node", "NodeFilter", "Event", "MouseEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "localStorage", "DOMRect", "CustomEvent", "KeyboardEvent", "PointerEvent", "FocusEvent", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const invoke = mock(async (_command: string, _args: unknown): Promise<string | null> => null);
const save = mock(async (): Promise<string | null> => null);
mock.module("@tauri-apps/api/core", () => ({ invoke }));
mock.module("@tauri-apps/plugin-dialog", () => ({ save, open: async () => null }));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true }));
let tabs: { id: string; location: { kind: string; path: string } }[] = [];
const prune = mock(() => {});
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: { getState: () => ({ tabs, recentStructures: [], pruneRecentStructures: prune }) } }));
mock.module("../apps/desktop/src/stores/shell-store", () => ({ useShellStore: { getState: () => ({ pinnedStructurePaths: [], projectRoots: [] }) } }));
const { createRoot } = await import("react-dom/client");
const { SidebarFileOperations, useSidebarFileMenus } = await import("../apps/desktop/src/components/sidebar/file-operations");
const { useBatchFileOperations } = await import("../apps/desktop/src/components/batch-file-operations");
const state = { documents: [], dirtyGridDocuments: new Set() } as unknown as ShellViewState;
const closeTabs = mock(async () => { tabs = []; });
const openPaths = mock(async (_paths: string[]) => {});
const actions = { closeTabs, openPaths, togglePinnedStructure: () => {} } as unknown as ShellActions;
let menus: MenuItemSpec[] = [];
function SingleMenus() { menus = useSidebarFileMenus()("/private/series.sdf"); return null; }
function Batch() { const operations = useBatchFileOperations(actions, state); menus = operations.items(["/private/a.sdf", "/private/b.sdf"]); return operations.dialog; }
async function fixture(batch: boolean, run: (mount: HTMLDivElement) => Promise<void>) {
  invoke.mockReset(); invoke.mockImplementation(async () => null); save.mockReset(); save.mockImplementation(async () => null);
  closeTabs.mockReset(); closeTabs.mockImplementation(async () => { tabs = []; }); openPaths.mockClear(); prune.mockClear(); tabs = [];
  const mount = document.createElement("div"); mount.className = "app-shell"; document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(batch ? <Batch /> : <SidebarFileOperations state={state} actions={actions}><SingleMenus /></SidebarFileOperations>));
    await run(mount);
  } finally { await act(async () => root.unmount()); mount.remove(); }
}
const command = (id: string) => { const item = menus.find(item => item.kind === "item" && item.id === id); if (item?.kind === "item") return item.action?.(); };
const submit = (mount: Element) => act(async () => { mount.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
const button = (mount: Element, text: string) => Array.from(mount.querySelectorAll("button")).find(el => el.textContent === text)!;
async function fill(mount: Element, name: string) {
  await act(async () => {
    const input = mount.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("rename validates names, links its error and submits the exact filesystem request once", async () => {
  await fixture(false, async mount => {
    await act(async () => { command("rename-file"); });
    for (const value of ["", " padded ", "../x", "a:b", ".."] ) { await fill(mount, value); await submit(mount); }
    expect(invoke).not.toHaveBeenCalled();
    expect(mount.querySelector("input")?.getAttribute("aria-describedby")).toBe(mount.querySelector('[role="alert"]')?.id);
    await fill(mount, "Series 2.sdf");
    let finish!: (path: string) => void; invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await submit(mount); await submit(mount);
    expect(invoke.mock.calls).toEqual([["operate_sidebar_file", { request: { operation: "rename", path: "/private/series.sdf", name: "Series 2.sdf" } }]]);
    expect([button(mount, "Cancel").disabled, button(mount, "Save").disabled]).toEqual([true, true]);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(mount.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => finish("/private/Series 2.sdf"));
    expect(openPaths.mock.calls).toEqual([[['/private/Series 2.sdf']]]);
    expect(mount.querySelector('[role="dialog"]')).toBeNull();
  });
});

test("failed operations keep a retry without exposing paths or raw errors; cancellation does not submit", async () => {
  await fixture(false, async mount => {
    invoke.mockImplementation(async () => { throw new Error("EACCES /private/secret"); });
    await act(async () => { command("duplicate-file"); });
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Could not complete this file operation. Try again.");
    expect(mount.textContent).not.toMatch(/EACCES|\/private/);
    invoke.mockImplementation(async () => "/private/copy.sdf"); await submit(mount);
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => { command("rename-file"); });
    await act(async () => button(mount, "Cancel").click());
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(mount.querySelector('[role="dialog"]')).toBeNull();
  });
});

test("an unsaved-tab cancellation prevents any filesystem change", async () => {
  for (const batch of [false, true]) await fixture(batch, async mount => {
    tabs = [{ id: "edited", location: { kind: "file", path: batch ? "/private/a.sdf" : "/private/series.sdf" } }];
    closeTabs.mockImplementation(async () => {});
    await act(async () => { command("trash-file"); });
    expect(invoke).not.toHaveBeenCalled();
    expect(mount.querySelector('[role="dialog"]')).toBeNull();
  });
});

test("batch failure retries only the unmoved files and blocks repeated pending retries", async () => {
  await fixture(true, async mount => {
    invoke.mockImplementation(async (_command, args) => { if ((args as { request: { path: string } }).request.path.endsWith("b.sdf")) throw new Error("internal path"); return null; });
    await act(async () => { command("trash-file"); });
    expect(mount.querySelector('ul')?.textContent).toBe("b.sdf");
    expect(mount.textContent).toContain("1 file moved."); expect(mount.textContent).not.toContain("internal path");
    let finish!: () => void; invoke.mockImplementation(() => new Promise(resolve => { finish = () => resolve(null); }));
    await act(async () => { button(mount, "Move to Trash").click(); button(mount, "Move to Trash").click(); });
    expect(invoke.mock.calls).toEqual(["a", "b", "b"].map(name => ["operate_sidebar_file", { request: { operation: "trash", path: `/private/${name}.sdf` } }]));
    expect(button(mount, "Cancel").disabled).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(mount.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => finish()); expect(mount.querySelector('[role="dialog"]')).toBeNull();
  });
});

test("a failed save picker retries the picker instead of copying to an empty destination", async () => {
  await fixture(false, async mount => {
    save.mockImplementation(async () => { throw new Error("picker failure"); });
    await act(async () => { await command("save-file-copy"); });
    expect(mount.querySelector('[role="alert"]')?.textContent).toBe("Could not choose a destination. Try again.");
    save.mockImplementation(async () => "/export/copy.sdf"); await submit(mount);
    expect(invoke.mock.calls).toEqual([["operate_sidebar_file", { request: { operation: "saveCopy", path: "/private/series.sdf", destination: "/export/copy.sdf" } }]]);
  });
});
