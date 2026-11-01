import assert from "node:assert/strict";
import { Window } from "happy-dom";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "CSS", "MutationObserver", "getComputedStyle"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const observers: Array<() => void> = [];
class Observer {
  constructor(callback: () => void) { observers.push(callback); }
  observe() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: Observer });
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
Object.assign(globalThis, {
  requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; },
  cancelAnimationFrame: (id: number) => frames.delete(id),
});
const { createElement, act, useRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useWorkspaceHeaderBand } = await import("../apps/desktop/src/hooks/use-workspace-header-band");
const container = document.createElement("div");
document.body.append(container);
const frame = document.createElement("iframe");
frame.className = "viewer-iframe";
frame.dataset.documentId = "protein";
document.body.append(frame);
const viewer = frame.contentDocument!;
viewer.body.innerHTML = '<div id="buret-toolbar"></div><div id="buret-viewport-corner"></div>';
Object.defineProperty(frame.contentWindow!, "ResizeObserver", { value: Observer });
let width = 300;
let dock = 0;
const rect = (left: number, width: number) => ({ left, right: left + width, width } as DOMRect);
frame.getBoundingClientRect = () => rect(80, width - dock);
viewer.getElementById("buret-viewport-corner")!.getBoundingClientRect = () => rect(Number.parseInt(viewer.documentElement.style.getPropertyValue("--burette-header-band-corner-left") || "10"), 34);
viewer.getElementById("buret-toolbar")!.getBoundingClientRect = () => rect(0, Math.min(155, Number.parseInt(viewer.documentElement.style.getPropertyValue("--burette-header-band-width"))));
function Header() {
  const ref = useRef<HTMLElement>(null);
  useWorkspaceHeaderBand(ref, "protein");
  return createElement("header", { ref }, createElement("div", { className: "workspace-file-title" }), createElement("button", { className: "annotate-toggle" }), createElement("div", { className: "workspace-file-band-slot" }), createElement("button", { className: "trailing" }));
}
const root = createRoot(container);
await act(async () => root.render(createElement(Header)));
const header = container.querySelector("header")!;
header.getBoundingClientRect = () => rect(80, width);
header.querySelector(".annotate-toggle")!.getBoundingClientRect = () => rect(0, 40);
header.querySelector(".trailing")!.getBoundingClientRect = () => rect(80 + width - 44, 34);
const measure = () => {
  observers.forEach(callback => callback());
  const pending = [...frames.values()]; frames.clear();
  pending.forEach(callback => callback(0));
};
const band = () => Object.fromEntries(["height", "toolbar-top", "right", "width"].map(key => [key, viewer.documentElement.style.getPropertyValue(`--burette-header-band-${key}`)]));
measure();
assert.deepEqual(band(), { height: "88px", "toolbar-top": "48px", right: "8px", width: "284px" });
assert.equal(header.style.getPropertyValue("--band-leading"), "48px", "Leading offset uses header-local coordinates");
assert.equal(header.hasAttribute("data-band-compact"), false, "A second-row toolbar leaves the first row to the file title");
width = 640; measure();
assert.deepEqual(band(), { height: "48px", "toolbar-top": "8px", right: "50px", width: "496px" });
assert.equal(header.style.getPropertyValue("--band-controls"), "155px");
width = 400; measure();
assert.equal(header.hasAttribute("data-band-compact"), true, "A title squeezed by the toolbar is dropped");
width = 640; dock = 400; measure();
assert.deepEqual(band(), { height: "88px", "toolbar-top": "48px", right: "8px", width: "224px" });
assert.equal(header.style.getPropertyValue("--band-controls"), "0px");
assert.equal(header.style.getPropertyValue("--band-slot-margin"), "0px", "A second-row toolbar must not push first-row file/dock actions past the header edge");
dock = 0; measure();
assert.equal(viewer.documentElement.style.getPropertyValue("--burette-header-band-height"), "48px");
const navigation = document.createElement("div");
navigation.className = "workspace-file-navigation";
navigation.getBoundingClientRect = () => rect(88, 28);
header.prepend(navigation);
measure();
assert.equal(viewer.documentElement.style.getPropertyValue("--burette-header-band-corner-left"), "42px", "Workspace navigation occupies the leftmost slot before the scene tree");
assert.equal(header.style.getPropertyValue("--band-leading"), "82px", "File and annotation controls follow both leading buttons");
await act(async () => root.unmount());
assert.equal(viewer.documentElement.hasAttribute("data-burette-header-band"), false);
assert.deepEqual(band(), { height: "", "toolbar-top": "", right: "", width: "" });
assert.equal(frames.size, 0);
assert.equal(viewer.documentElement.style.getPropertyValue("--burette-header-band-corner-left"), "");
await browser.happyDOM.close();
console.log("Shared header band: narrow/wide/dock transitions, local coordinates and cleanup passed");
