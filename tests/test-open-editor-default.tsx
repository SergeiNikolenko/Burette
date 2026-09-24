import assert from "node:assert/strict";
import { Window } from "happy-dom";
const window = new Window({ url: "http://localhost/" });
for (const name of ["document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "getComputedStyle", "ResizeObserver", "KeyboardEvent"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: (window as any)[name] });
}
Object.assign(globalThis, { window, IS_REACT_ACT_ENVIRONMENT: true });
(window as any).BuretteMcpWorkspace = {};
const beforeFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  const { targetId } = JSON.parse(options!.body as string);
  return Response.json({ iconUrl: `data:image/png;base64,${btoa(targetId)}` });
};
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { OpenInEditorMenu } = await import("../apps/desktop/src/components/open-in-editor-menu");
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container), calls: unknown[] = [];
const preferences = { openInDefaultDestination: "default-app" };
const actions = {
  listChemicalEditorTargets: async () => [{ id: "maestro", name: "Maestro", rank: 1, supportedExtensions: ["pdb"] }],
  setPreference(key: string, value: string) { assert.equal(key, "openInDefaultDestination"); preferences.openInDefaultDestination = value; },
  openPathInChemicalEditor: (...args: unknown[]) => calls.push(["editor", ...args]),
  openPathWithDefaultApp: (...args: unknown[]) => calls.push(["system", ...args]),
  revealPath: (...args: unknown[]) => calls.push(["finder", ...args]),
  toggleDock() {},
};
const render = () => act(async () => root.render(createElement(OpenInEditorMenu, {
  presentation: "file-header", actions: { ...actions } as any,
  state: { activeDocument: { path: "/authorized/1htb.pdb", title: "1htb.pdb" }, preferences: { ...preferences }, sidebarProjects: [] } as any,
})));
try {
  await render();
  await act(async () => container.querySelector('[aria-label="Open in another application"]')!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, button: 0 })));
  const submenu = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent === "Default for Open") as HTMLElement;
  assert.ok(submenu);
  await act(async () => {
    submenu.focus();
    submenu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  const choice = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find(el => el.textContent === "Maestro") as HTMLElement;
  assert.ok(choice);
  await act(async () => choice.click());
  assert.equal(preferences.openInDefaultDestination, "editor:maestro");
  assert.deepEqual(calls, [], "Changing the default must not launch an app or change OS associations");
  await render();
  const primary = container.querySelector('[aria-label="Open in Maestro"]') as HTMLElement;
  assert.ok(primary);
  assert.equal(primary.querySelector('img')?.src, `data:image/png;base64,${btoa("maestro")}`);
  await act(async () => primary.click());
  assert.deepEqual(calls, [["editor", "/authorized/1htb.pdb", "maestro", "Maestro"]]);
} finally {
  await act(async () => root.unmount());
  globalThis.fetch = beforeFetch;
  await window.happyDOM.close();
}
console.log("Open default menu persists the selected destination and routes primary Open with its icon");
