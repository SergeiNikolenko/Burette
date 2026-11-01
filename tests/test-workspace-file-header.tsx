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
let root = createRoot(container);
const render = async (path: string, open = false, fileActionsAvailable = true) => act(async () => root.render(createElement(WorkspaceFileHeader, {
  fileActionsAvailable,
  activeFile: { path, label: "structure" }, rightDockOpen: open,
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
assert.equal(container.querySelector('[aria-label="Annotate"]'), null, "Standalone workspaces must not expose plugin annotation");
(window as any).BuretteMcpWorkspace = {};
await render(path);
const title = () => container.querySelector(".workspace-file-title");
assert.equal(title()?.textContent, "1htb.pdb");
assert.equal(title()?.getAttribute("title"), path);
// Under happy-dom Radix may keep the menu open after a selection, so every
// choice ends by unmounting; the next render starts from a closed menu.
const choose = async (item: string) => {
  await act(async () => container.querySelector('[aria-label="Open in another application"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false })));
  const entry = [...document.querySelectorAll('[role="menuitem"]')].find(element => element.textContent === item);
  assert.ok(entry, `${item} is in the Open menu`);
  await act(async () => (entry as HTMLElement).click());
  await act(async () => root.unmount());
  root = createRoot(container);
};
await act(async () => {
  for (const label of ["Toggle right panel", "Annotate", "Open with default app"]) {
    (container.querySelector(`[aria-label="${label}"]`) as HTMLElement).click();
  }
});
await choose("Example editor");
await render(path);
await choose("Copy path");
assert.deepEqual(calls, [["dock", "right"], ["default", path], ["editor", path], ["copy", path, "file"]]);
await render(path);
assert.equal(container.querySelector('[aria-label="Toggle bottom panel"]'), null);
assert.equal(container.querySelector('[aria-label="Annotate"][aria-pressed="true"]')?.textContent?.startsWith("Annotate"), true);
await render("/other/mini.pdb", true);
assert.equal(title()?.textContent, "mini.pdb");
assert.equal(container.querySelectorAll('[aria-pressed="true"]').length, 2);
await choose("Copy path");
assert.deepEqual(calls.at(-1), ["copy", "/other/mini.pdb", "file"]);
await render("burette-ketcher:browser-123/sketch.sdf", true, false);
assert.equal(container.querySelector('[aria-label="Open in another application"]'), null);
assert.equal(container.querySelector('[aria-label="Open with default app"]'), null);
assert.equal(title()?.textContent, "structureUnsaved");
assert.equal(title()?.hasAttribute("title"), false, "Unsaved sketches do not expose their internal path");
assert.equal(container.querySelectorAll('[aria-pressed="true"]').length, 2);
await act(async () => root.unmount());
await window.happyDOM.close();
console.log("File header: file title, path copy from the Open menu, right dock and annotate toggles, active file updates and unsaved sketches passed");
