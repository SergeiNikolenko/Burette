import assert from "node:assert/strict";
import { Window } from "happy-dom";
const window = new Window({ url: "http://localhost/" });
for (const name of ["document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "getComputedStyle", "ResizeObserver"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: (window as any)[name] });
}
Object.assign(globalThis, { window, IS_REACT_ACT_ENVIRONMENT: true });
(window as any).BuretteMcpWorkspace = {};
const beforeFetch = globalThis.fetch;
const iconRequests: string[] = [];
globalThis.fetch = async (_url, options) => {
  iconRequests.push(JSON.parse(options!.body as string).path);
  return Response.json({ iconUrl: "data:image/png;base64,iVBORw0KGgo=" });
};
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { OpenInEditorMenu } = await import("../apps/desktop/src/components/open-in-editor-menu");
const calls: string[] = [];
const listChemicalEditorTargets = async (path: string) => { calls.push(path); return []; };
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
const render = async (path: string) => act(async () => root.render(createElement(OpenInEditorMenu, {
  presentation: "file-header",
  state: { activeDocument: { path, title: "Sketch" }, preferences: { openInDefaultDestination: "auto" }, sidebarProjects: [] } as any,
  // Panel changes may recreate callbacks as well as the surrounding object.
  actions: { listChemicalEditorTargets: (value: string) => listChemicalEditorTargets(value), toggleDock() {} } as any,
})));
try {
  await render("/authorized/pose.sdf");
  const icon = container.querySelector('.workspace-file-open-primary img')?.getAttribute('src');
  assert.ok(icon);
  for (let i = 0; i < 10; i++) await render("/authorized/pose.sdf");
  assert.deepEqual(calls, ["/authorized/pose.sdf"], "Rerenders must not rediscover applications");
  assert.equal(container.querySelector('.workspace-file-open-primary img')?.getAttribute('src'), icon);
  assert.equal(iconRequests.length, 2, "Rerenders must not clear or reload the Finder/default icons");
  const iconCount = iconRequests.length;
  for (let i = 0; i < 10; i++) await render("burette-ketcher:browser-123/sketch.sdf");
  assert.equal(calls.length, 1);
  assert.equal(iconRequests.length, iconCount, "Virtual documents must not request application icons");
  assert.ok(container.textContent?.includes("Unsaved"));
  assert.ok(!container.textContent?.includes("burette-ketcher:"));
  await render("/authorized/other.pdb");
  assert.deepEqual(calls, ["/authorized/pose.sdf", "/authorized/other.pdb"]);
} finally {
  await act(async () => root.unmount());
  globalThis.fetch = beforeFetch;
  await window.happyDOM.close();
}
console.log("Open menu: stable discovery across rerenders and no filesystem requests for virtual documents passed");
