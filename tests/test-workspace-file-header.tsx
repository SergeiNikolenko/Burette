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
container.className = "app-shell";
document.body.append(container);
const root = createRoot(container);
const render = async (path: string) => act(async () => root.render(createElement(WorkspaceFileHeader, {
  activeFile: { path, label: "structure" }, defaultApplicationIconUrl: null,
  actions: {
    openPathWithDefaultApp: async (...args: unknown[]) => { calls.push(["default", ...args]); },
  },
  items: [{ kind: "item", id: "editor", text: "Example editor", action: () => calls.push(["editor", path]) }],
})));
await render("/samples/mvs/docking_story.mvsx");
assert.equal(container.querySelector(".workspace-file-name")?.textContent, "docking_story.mvsx");
assert.equal(container.querySelector(".workspace-file-parent")?.textContent, "mvs");
await act(async () => {
  assert.equal(container.querySelector('[aria-label="Open in folder"]'), null);
  (container.querySelector('[aria-label="Open with default app"]') as HTMLElement).click();
  container.querySelector('[aria-label="Open in another application"]')!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }));
});
assert.ok(document.querySelector('[role="menu"]'), "Application menu opens");
await act(async () => (document.querySelector('[role="menuitem"]') as HTMLElement).click());
assert.deepEqual(calls, [["default", "/samples/mvs/docking_story.mvsx"], ["editor", "/samples/mvs/docking_story.mvsx"]]);
await render("/samples/mini.pdb");
assert.equal(container.querySelector(".workspace-file-name")?.textContent, "mini.pdb");
assert.equal(container.querySelectorAll('[role="tooltip"]').length, 2);
await act(async () => root.unmount());
await window.happyDOM.close();
console.log("File header: filename updates, no standalone folder, default app, application menu and tooltip content passed.");
