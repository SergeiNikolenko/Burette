import assert from "node:assert/strict";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
for (const name of ["document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "getComputedStyle", "ResizeObserver"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: (window as any)[name] });
}
Object.assign(globalThis, { window, IS_REACT_ACT_ENVIRONMENT: true });
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { WorkspaceFileHeader } = await import("../apps/desktop/src/components/workspace-file-header");
const calls: unknown[] = [];
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
const render = async (path: string, open = false, fileActionsAvailable = true) => act(async () => root.render(createElement(WorkspaceFileHeader, {
  fileActionsAvailable,
  activeFile: { path, label: "structure" }, rootPath: "/project/Burette", rightDockOpen: open, bottomDockOpen: open,
  defaultApplicationIconUrl: null,
  actions: {
    copyPath: async (...args: unknown[]) => { calls.push(["copy", ...args]); },
    toggleDock: (area: string) => { calls.push(["dock", area]); },
    openPathWithDefaultApp: async (path: string) => { calls.push(["default", path]); },
  },
  items: [{ kind: "item", id: "editor", text: "Example editor", action: () => calls.push(["editor", path]) }],
})));
const path = "/project/Burette/samples/proteins/1htb.pdb";
await render(path);
assert.equal(container.querySelector(".workspace-file-breadcrumb")?.textContent, "Burettesamplesproteins1htb.pdb");
assert.equal(container.querySelector(".workspace-file-breadcrumb")?.getAttribute("aria-label"), path);
assert.equal(container.querySelector("[aria-current=page]")?.textContent, "1htb.pdb");
await act(async () => {
  for (const label of ["Copy file path", "Toggle right panel", "Toggle bottom panel", "Open with default app"]) {
    (container.querySelector(`[aria-label="${label}"]`) as HTMLElement).click();
  }
  container.querySelector('[aria-label="Open in another application"]')!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }));
});
assert.ok(document.querySelector('[role="menu"]'));
await act(async () => (document.querySelector('[role="menuitem"]') as HTMLElement).click());
assert.deepEqual(calls, [["copy", path, "file"], ["dock", "right"], ["dock", "bottom"], ["default", path], ["editor", path]]);
await render("/other/mini.pdb", true);
assert.equal(container.querySelector("[aria-current=page]")?.textContent, "mini.pdb");
assert.equal(container.querySelectorAll('[aria-pressed="true"]').length, 2);
await act(async () => (container.querySelector('[aria-label="Copy file path"]') as HTMLElement).click());
assert.deepEqual(calls.at(-1), ["copy", "/other/mini.pdb", "file"]);
await render("burette-ketcher:browser-123/sketch.sdf", true, false);
assert.equal(container.querySelector('[aria-label="Copy file path"]'), null);
assert.equal(container.querySelector('[aria-label="Open with default app"]'), null);
assert.ok(container.textContent?.includes("Unsaved"));
assert.ok(!container.textContent?.includes("burette-ketcher:"));
assert.equal(container.querySelectorAll('[aria-pressed="true"]').length, 2);
await act(async () => root.unmount());
await window.happyDOM.close();
console.log("File header: breadcrumbs, full-path copy, both dock toggles, active file updates and Open menu passed");
