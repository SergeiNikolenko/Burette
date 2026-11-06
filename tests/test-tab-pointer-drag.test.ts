import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript-compiler-api";

// Exercise the actual pointer controller without mounting molecular renderers.
function controller() {
  const source = readFileSync("apps/desktop/src/components/editor-area/editor-tabs.tsx", "utf8");
  const fragment = source.slice(source.indexOf("  const startMouseTabReorder ="), source.indexOf("\n  useEffect(() => {\n    const escape"));
  const js = ts.transpileModule(fragment, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
  const listeners = new Map<string, Function>();
  const moves: unknown[] = [], drops: unknown[] = [];
  const strip = {};
  let target: unknown = strip;
  const mouse = { current: null as any }, remove = { current: null as any }, snapshot = { current: null as string[] | null };
  const suppressed = { current: false };
  const window = {
    innerWidth: 1000, innerHeight: 700,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    addEventListener: (name: string, fn: Function) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
    dispatchEvent: (event: any) => drops.push(event.detail),
    setTimeout: (fn: Function) => fn(),
  };
  let captures = 0;
  const button = { setPointerCapture: () => captures++, hasPointerCapture: () => true, releasePointerCapture: () => captures-- };
  const cleanup = () => { remove.current?.(); mouse.current = null; };
  const stop = () => { cleanup(); };
  const values = {
    tracePerf: () => {},
    useCallback: (fn: Function) => fn,
    canTransferNativeTab: () => false,
    useMoleculeStore: { getState: () => ({ promotePreviewTab: () => {} }) },
    removeMouseDragListeners: cleanup, mouseDragRef: mouse,
    draggingTabIdRef: { current: null }, setDraggingTabId: () => {},
    actions: { setStructureDragActive: () => {} }, state: { tabs: [{ id: "dirty-grid" }, { id: "empty-sketch" }] },
    reorderSnapshotRef: snapshot, suppressDragClickRef: suppressed,
    moveDraggedTabRef: { current: (...args: unknown[]) => moves.push(args) },
    stripRef: { current: strip }, moveDraggedTab: (...args: unknown[]) => moves.push(args),
    runTabDropAtPoint: (...args: unknown[]) => drops.push(args), stopTabDrag: stop,
    removeMouseDragListenersRef: remove, window,
    document: { elementFromPoint: () => ({ closest: () => target }) },
    TAB_MOUSE_REORDER_THRESHOLD_PX: 8,
    CustomEvent: class { constructor(public type: string, public options: any) {} get detail() { return this.options.detail; } },
  };
  const start = new Function(...Object.keys(values), `${js}; return startMouseTabReorder;`)(...Object.values(values));
  return { start: (id: string, altKey = false) => start(id, true, { button: 0, altKey, pointerId: 1, currentTarget: button, clientX: 0, clientY: 0 }),
    move: (x: number, buttons = 1) => listeners.get("pointermove")?.({ buttons, clientX: x, clientY: 0 }),
    up: (x = 70, y = 10) => listeners.get("pointerup")?.({ clientX: x, clientY: y }),
    target: (value: unknown) => { target = value; }, moves, drops, snapshot, suppressed, captures: () => captures };
}

test.each(["dirty-grid", "empty-sketch"])("%s reorders without requesting export", id => {
  const drag = controller(); drag.start(id); drag.move(3);
  expect(drag.moves).toEqual([]);
  drag.move(70);
  expect(drag.moves).toEqual([[id, 70]]);
  expect(drag.snapshot.current).toEqual(["dirty-grid", "empty-sketch"]);
  drag.up();
  expect(drag.drops).toEqual([{ tabId: id, x: 70, y: 10 }]);
  expect(drag.snapshot.current).toBeNull();
  expect(drag.captures()).toBe(0);
});

test("another pane receives a targeted drop, not a source-strip reorder", () => {
  const drag = controller(); drag.start("dirty-grid"); drag.target({}); drag.move(70);
  expect(drag.moves).toEqual([]);
  drag.up();
  expect(drag.drops).toEqual([{ tabId: "dirty-grid", x: 70, y: 10 }]);
});

test("Option-drag leaves the native file export gesture available", () => {
  const drag = controller(); drag.start("dirty-grid", true); drag.move(70);
  expect(drag.moves).toEqual([]);
  expect(drag.captures()).toBe(0);
});

test("a fast local drag commits its release position without an intermediate move", () => {
  const drag = controller(); drag.start("dirty-grid"); drag.up();
  expect(drag.drops).toEqual([{ tabId: "dirty-grid", x: 70, y: 10 }]);
  expect(drag.snapshot.current).toBeNull();
  expect(drag.captures()).toBe(0);
});

test("pointer movement without the primary button cancels before a later release", () => {
  const drag = controller(); drag.start("dirty-grid"); drag.move(70, 0); drag.up();
  expect(drag.drops).toEqual([]);
  expect(drag.moves).toEqual([]);
  expect(drag.captures()).toBe(0);
});

test("a short click and an unstarted drag released outside the window do not drop", () => {
  for (const [x, y] of [[3, 2], [-20, 10], [1000, 10], [70, 700]]) {
    const drag = controller(); drag.start("dirty-grid"); drag.up(x, y);
    expect(drag.drops).toEqual([]);
    expect(drag.moves).toEqual([]);
    expect(drag.captures()).toBe(0);
  }
});
