import { beforeEach, expect, mock, test } from "bun:test";
let outcome: any;
let tabs: any[];
let reason: string | null;
let transferSucceeds: boolean;
const commands: unknown[] = [], transfers: unknown[] = [], drops: unknown[] = [];
let hitStrip = true;
let grid = false;
mock.module("../apps/desktop/src/components/workspace-panes/native-grid-window", () => ({ canTransferNativeGridTab: () => grid, transferNativeGridTab: async (...args: unknown[]) => { transfers.push(["grid", ...args]); return true; } }));
mock.module("../apps/desktop/src/components/workspace-panes/native-page-window", () => ({ openNativePageWindow: async (...args: unknown[]) => { transfers.push(["page", ...args]); return true; } }));
mock.module("@tauri-apps/api/core", () => ({ invoke: async (...args: unknown[]) => { commands.push(args); return outcome; } }));
mock.module("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "source" }) }));
mock.module("../apps/desktop/src/lib/native-file-drag", () => ({ canStartNativeFileDrag: () => true }));
mock.module("../apps/desktop/src/stores/molecule-store", () => ({ useMoleculeStore: { getState: () => ({ tabs, documents: [{ id: "doc", title: "Scene" }] }) } }));
mock.module("../apps/desktop/src/components/workspace-panes/native-scene-window", () => ({
  nativePopoutReason: () => reason,
  popOutNativeScene: async (...args: unknown[]) => { transfers.push(args); if (transferSucceeds) tabs = []; },
}));
Object.assign(globalThis, {
  window: { innerWidth: 500, dispatchEvent: (event: any) => drops.push(event.detail) },
  document: { elementFromPoint: (x: number, y: number) => { expect([x, y]).toEqual([100, 20]); return { closest: () => hitStrip ? {} : null }; } },
});
const { transferNativeTab } = await import("../apps/desktop/src/components/editor-area/native-tab-transfer");
beforeEach(() => {
  tabs = [{ id: "tab", location: { kind: "file", documentId: "doc" } }];
  reason = null; grid = false; transferSucceeds = true; hitStrip = true;
  commands.length = transfers.length = drops.length = 0;
});
test("cancelled drag retains its source without creating a window", async () => {
  outcome = { outcome: "cancelled" };
  expect(await transferNativeTab("tab")).toBe(false);
  expect(transfers).toEqual([]);
  expect(tabs).toHaveLength(1);
});
test("source-window drop maps logical coordinates to zoomed CSS strip", async () => {
  outcome = { outcome: "window", windowLabel: "source", viewportWidth: 1000, position: { x: 200, y: 40 } };
  expect(await transferNativeTab("tab")).toBe(true);
  expect(drops).toEqual([{ tabId: "tab", x: 100, y: 20 }]);
  expect(transfers).toEqual([]);
  hitStrip = false;
  expect(await transferNativeTab("tab")).toBe(false);
});
test.each(["window", "outside"])("%s drop transfers only through acknowledged scene flow", async kind => {
  outcome = kind === "window" ? { outcome: kind, windowLabel: "destination", viewportWidth: 1000, position: { x: 200, y: 40 } } : { outcome: kind, position: { x: 700, y: 400 } };
  expect(await transferNativeTab("tab")).toBe(true);
  expect(transfers).toEqual([["tab", kind === "window" ? "destination" : undefined, kind === "window"
    ? { targetPosition: { x: 200, y: 40 }, targetViewportWidth: 1000 }
    : { screenPosition: { x: 700, y: 400 } }]]);
});
test("unsupported and failed transfers retain original", async () => {
  reason = "Save the collection";
  expect(await transferNativeTab("tab")).toBe(false);
  expect(commands).toEqual([]);
  reason = null; grid = false; transferSucceeds = false; outcome = { outcome: "outside" };
  expect(await transferNativeTab("tab")).toBe(false);
  expect(tabs).toHaveLength(1);
});

test("frontend cancellation rejects a late native success before transfer", async () => {
  outcome = { outcome: "outside", position: { x: 10, y: 10 } };
  expect(await transferNativeTab("tab", () => true)).toBe(false);
  expect(transfers).toEqual([]);
});

test("dirty collections use their snapshot transfer and sketches use page transfer", async () => {
  outcome = { outcome: "outside", position: { x: 5, y: 6 } };
  reason = "Not a scene"; grid = true;
  expect(await transferNativeTab("tab")).toBe(true);
  expect(transfers[0]).toEqual(["grid", "tab", undefined, { screenPosition: { x: 5, y: 6 } }]);
  grid = false; tabs = [{ id: "tab", location: { kind: "ketcher", draftKet: "draft" } }];
  expect(await transferNativeTab("tab")).toBe(true);
  expect(transfers[1]).toEqual(["page", tabs[0], { screenPosition: { x: 5, y: 6 }, targetWindow: undefined, move: true }]);
});
