import { test, expect, spyOn } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";
import { readFileSync } from "node:fs";

const browser = new Window();
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "CSS", "CustomEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { pinViewerFrames } = await import("../apps/desktop/src/components/editor-area/viewer-frame");
const { MarqueeName } = await import("../apps/desktop/src/components/marquee-name");
const { useXyzrenderPlayback } = await import("../apps/desktop/src/hooks/use-xyzrender-playback");
const { postToXyzrenderViewer, requestViewerAction, requestGridView } = await import("../apps/desktop/src/lib/viewer-bridge");

test("folder indexing marks draggable ancestors once and walks wide/deep trees without spread or recursive copies", () => {
  // Test private data algorithms without adding production exports for tests.
  const source = readFileSync(new URL("../apps/desktop/src/components/sidebar/file-tree-node.tsx", import.meta.url), "utf8");
  const functions = source.slice(source.indexOf("function buildProjectTree("), source.indexOf("function collectProjectFolderPathsFor("));
  const js = new Bun.Transpiler({ loader: "tsx" }).transformSync(functions);
  const { buildProjectTree, collectProjectFolderPaths } = new Function(`${js}; return { buildProjectTree, collectProjectFolderPaths };`)();
  const tree = buildProjectTree([{ key: "one", relativePath: "a/b/one.pdb" }, { key: "two", relativePath: "a/two.pdb" }], ["a/b", "empty/sub"]);
  expect(tree.map((node: any) => [node.path, node.hasItems, node.children[0].hasItems])).toEqual([["a", true, true], ["empty", false, false]]);
  expect(collectProjectFolderPaths(tree)).toEqual(["a", "a/b", "empty", "empty/sub"]);
  const wide = Array.from({ length: 140_000 }, (_, i) => ({ kind: "folder", path: String(i), children: [] }));
  expect(collectProjectFolderPaths([{ kind: "folder", path: "root", children: wide }]).length).toBe(140_001);
  let deep: any = { kind: "folder", path: "leaf", children: [] };
  for (let i = 0; i < 12_000; i++) deep = { kind: "folder", path: String(i), children: [deep] };
  expect(collectProjectFolderPaths([deep]).length).toBe(12_001);
});

test("frame pinning batches layout reads, preserves styles and isolates shell roots", () => {
  const first = document.createElement("div"), second = document.createElement("div");
  first.innerHTML = '<iframe class="viewer-iframe"></iframe>'.repeat(3);
  second.innerHTML = '<iframe class="viewer-iframe"></iframe>';
  const frames = [...first.querySelectorAll("iframe")];
  for (const frame of frames) frame.style.setProperty("width", "75%", "important");
  frames.forEach((frame, index) => { frame.getBoundingClientRect = () => {
    expect(frames.map(f => f.style.width)).toEqual(["75%", "75%", "75%"]);
    return { width: index === 2 ? 0 : 500, height: 300 } as DOMRect;
  }; });
  const other = second.querySelector("iframe")!;
  other.getBoundingClientRect = () => ({ width: 100, height: 100 }) as DOMRect;
  const release = pinViewerFrames(first), nested = pinViewerFrames(first), independent = pinViewerFrames(second);
  expect(frames.map(f => f.style.width)).toEqual(["500px", "500px", "75%"]);
  release(); release();
  expect(first.hasAttribute("data-resizing")).toBe(true);
  independent();
  expect(second.hasAttribute("data-resizing")).toBe(false);
  expect(first.hasAttribute("data-resizing")).toBe(true);
  nested();
  expect(frames.map(f => [f.style.width, f.style.getPropertyPriority("width"), f.style.height])).toEqual([
    ["75%", "important", ""], ["75%", "important", ""], ["75%", "important", ""],
  ]);
});

test("500 inactive file names do not measure layout or allocate resize observers", async () => {
  const original = globalThis.ResizeObserver;
  let observes = 0, disconnects = 0, reads = 0;
  globalThis.ResizeObserver = class {
    observe() { observes++; } disconnect() { disconnects++; } unobserve() {}
  } as unknown as typeof ResizeObserver;
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () => root.render(<>{Array.from({ length: 500 }, (_, i) => <div className="project" key={i}>
      <MarqueeName className="project-name">{`long-file-name-${i}.pdb`}</MarqueeName>
    </div>)}</>));
    expect(observes).toBe(0);
    const row = mount.firstElementChild!;
    const box = row.firstElementChild as HTMLElement;
    Object.defineProperty(box, "clientWidth", { get() { reads++; return 50; } });
    Object.defineProperty(box.firstElementChild, "scrollWidth", { get() { reads++; return 150; } });
    row.dispatchEvent(new browser.Event("pointerenter"));
    expect([observes, reads, box.style.getPropertyValue("--marquee-shift")]).toEqual([1, 2, "100px"]);
    row.dispatchEvent(new browser.Event("pointerleave"));
    expect(disconnects).toBe(1);
    row.dispatchEvent(new browser.FocusEvent("focusin"));
    expect(observes).toBe(2);
    row.dispatchEvent(new browser.FocusEvent("focusout", { relatedTarget: null }));
    expect(disconnects).toBe(2);
  } finally { await act(async () => root.unmount()); mount.remove(); globalThis.ResizeObserver = original; }
});

test("animation sends once when paused, keeps its clock across equal ranges, clamps and avoids idle loops", async () => {
  const originalRequest = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  const pending = new Map<number, FrameRequestCallback>(); let serial = 0;
  globalThis.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; };
  globalThis.cancelAnimationFrame = id => { pending.delete(id); };
  const clock = spyOn(performance, "now").mockReturnValue(0);
  const mount = document.createElement("div"), viewer = document.createElement("iframe");
  viewer.className = "viewer-iframe"; viewer.dataset.documentId = "movie";
  document.body.append(mount, viewer);
  const paints: any[] = [];
  viewer.contentWindow!.postMessage = message => { paints.push(message.body); };
  const animation = { width: 1, height: 1, frames: [new Uint8ClampedArray([0]), new Uint8ClampedArray([1])] };
  const root = createRoot(mount);
  let scrub!: (value: number) => void;
  function Harness({ playing = false, range = [0, 1], fps = 10, data = animation }) {
    const [, set] = useXyzrenderPlayback(data, playing, fps, range, "item", "movie", false, true);
    scrub = set; return null;
  }
  const render = (props: React.ComponentProps<typeof Harness> = {}) => act(async () => root.render(<Harness {...props} />));
  try {
    await render();
    expect(paints.length).toBe(1);
    await render();
    expect(paints.length).toBe(1);
    await act(async () => scrub(1000));
    expect(paints.at(-1).pixels[0]).toBe(1);
    await act(async () => scrub(NaN));
    expect(paints.at(-1).pixels[0]).toBe(0);
    await render({ range: [1, 1] });
    await act(async () => scrub(0));
    expect(paints.at(-1).pixels[0]).toBe(0); // Export bounds do not restrict the rotation slider.
    const longer = { ...animation, frames: Array.from({ length: 20 }, (_, i) => new Uint8ClampedArray([i])) };
    await act(async () => { root.render(<Harness data={longer} range={[0, 19]} />); scrub(18); });
    expect(paints.at(-1).pixels[0]).toBe(18); // No clamp against the previous animation's bounds.
    await render(); await act(async () => scrub(0));
    await render({ playing: true });
    const scheduled = [...pending.keys()];
    await render({ playing: true, range: [0, 1] });
    expect([...pending.keys()]).toEqual(scheduled);
    const before = paints.length;
    const callbacks = [...pending.values()]; pending.clear();
    await act(async () => callbacks.forEach(callback => callback(200)));
    expect(paints.length).toBe(before); // Two steps wrap to the already displayed frame.
    await render({ playing: true, range: [10, -1] });
    expect(pending.size).toBe(0);
    expect(paints.at(-1).pixels[0]).toBe(1);
    await render({ playing: true, fps: Infinity });
    expect(pending.size).toBe(0);
    await render({ playing: true, fps: 0 });
    expect(pending.size).toBe(0);
  } finally {
    await act(async () => root.unmount()); expect(pending.size).toBe(0);
    mount.remove(); viewer.remove(); clock.mockRestore();
    globalThis.requestAnimationFrame = originalRequest; globalThis.cancelAnimationFrame = originalCancel;
  }
});

test("closed animation target never broadcasts to unrelated scenes", () => {
  const viewer = document.createElement("iframe"); viewer.className = "viewer-iframe";
  document.body.append(viewer);
  let posts = 0; viewer.contentWindow!.postMessage = () => { posts++; };
  try {
    postToXyzrenderViewer("closed", { type: "applyXyzrenderAnimationFrame" });
    expect(posts).toBe(0);
    postToXyzrenderViewer(undefined, { type: "legacy" });
    expect(posts).toBe(1);
  } finally { viewer.remove(); }
});

test("viewer transport releases timers/listeners on clone errors and ignores unrelated grid messages without DOM lookup", async () => {
  const viewer = document.createElement("iframe"); viewer.className = "viewer-iframe";
  viewer.dataset.documentId = "target"; viewer.dataset.renderer = "molstar"; document.body.append(viewer);
  const clearTimeout = spyOn(window, "clearTimeout"), clearInterval = spyOn(window, "clearInterval");
  const remove = spyOn(window, "removeEventListener");
  const error = new Error("cannot clone");
  viewer.contentWindow!.postMessage = () => { throw error; };
  try {
    await expect(requestViewerAction("target", {})).rejects.toBe(error);
    expect(clearTimeout).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.filter(([type]) => type === "message").length).toBe(1);
    viewer.dataset.renderer = "grid2d";
    await expect(requestGridView("target", "cards")).rejects.toBe(error);
    expect(clearInterval).toHaveBeenCalledTimes(1);
    let request: any;
    viewer.contentWindow!.postMessage = message => { request = message; };
    const promise = requestGridView("target", "table");
    const query = spyOn(document, "querySelector");
    for (let i = 0; i < 100; i++) window.dispatchEvent(new browser.MessageEvent("message", { data: { source: "burette-viewer", body: { type: "trajectoryFrameChanged" } } }));
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
    window.dispatchEvent(new browser.MessageEvent("message", { source: viewer.contentWindow as any, data: {
      source: "burette-grid", body: { type: "gridMenuCommandResult", requestId: request.body.requestId },
    } }));
    await promise;
  } finally { viewer.remove(); clearTimeout.mockRestore(); clearInterval.mockRestore(); remove.mockRestore(); }
});
