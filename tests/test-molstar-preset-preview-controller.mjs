#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sourceUrl = new URL(
  "../PreviewExtension/Web/molstar-preset-preview-controller.js",
  import.meta.url,
);
const source = await readFile(sourceUrl, "utf8");
const context = vm.createContext({ console });
vm.runInContext(source, context, { filename: sourceUrl.pathname });

const factory = vm.runInContext(
  "globalThis.BuretteMolstarPresetPreviewController",
  context,
);
assert.equal(typeof factory?.create, "function");
assert.equal(typeof factory?.computePreviewPlacement, "function");
assert.equal(typeof factory?.computePreviewCanvasLayout, "function");
assert.equal(typeof factory?.computePreviewContentBounds, "function");
assert.equal(typeof factory?.focusPointerTarget, "function");
assert.equal(typeof factory?.retainPointerTarget, "function");

{
  const calls = [];
  const listeners = new Map();
  const target = {
    classList: {
      add: (name) => calls.push(["class:add", name]),
      remove: (name) => calls.push(["class:remove", name]),
    },
    addEventListener: (type, listener, options) => {
      listeners.set(type, listener);
      calls.push(["listen", type, options?.once]);
    },
    focus: (options) => calls.push(["focus", options?.preventScroll]),
  };
  const retained = factory.retainPointerTarget(
    { button: 0, preventDefault: () => calls.push("prevent") },
    target,
    () => calls.push("cancel"),
  );
  assert.equal(retained, true);
  assert.deepEqual(calls, [
    "cancel",
    ["class:add", "buret-pointer-focus"],
    ["listen", "blur", true],
    ["focus", true],
  ]);
  listeners.get("blur")?.();
  assert.deepEqual(calls.at(-1), ["class:remove", "buret-pointer-focus"]);
  assert.equal(factory.retainPointerTarget({ button: 2 }, null, null), false);
}

{
  const width = 12;
  const height = 8;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) pixels[index * 4 + 3] = 255;
  for (let y = 2; y <= 5; y += 1) {
    for (let x = 1; x <= 4; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 40;
      pixels[offset + 1] = 150;
      pixels[offset + 2] = 220;
    }
  }
  assert.deepEqual(
    factory.computePreviewContentBounds({
      data: pixels,
      width,
      height,
      background: [0, 0, 0],
      paddingRatio: 0,
      minPadding: 0,
    }),
    { x: 1, y: 2, width: 4, height: 4 },
  );
  assert.deepEqual(
    factory.computePreviewContentBounds({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      transparent: true,
    }),
    { x: 0, y: 0, width, height },
  );
}

for (const [sourceWidth, sourceHeight] of [[200, 600], [400, 400], [600, 200]]) {
  const layout = factory.computePreviewCanvasLayout({
    sourceWidth,
    sourceHeight,
    viewportWidth: 948,
    viewportHeight: 994,
    devicePixelRatio: 2,
  });
  assert.ok(layout.cardWidth <= 240);
  assert.ok(layout.bodyHeight <= 320);
  assert.equal(layout.cardHeight, 28 + layout.bodyHeight);
  assert.equal(layout.drawX, 0);
  assert.equal(layout.drawY, 0);
  assert.equal(layout.drawWidth, layout.cardWidth);
  assert.equal(layout.drawHeight, layout.bodyHeight);
  assert.ok(Math.abs(layout.cardWidth / layout.bodyHeight - sourceWidth / sourceHeight) < 0.001);
}

const viewportReplica = factory.computePreviewCanvasLayout({
  sourceWidth: 884,
  sourceHeight: 994,
  viewportWidth: 884,
  viewportHeight: 994,
  devicePixelRatio: 2,
});
assert.ok(Math.abs(viewportReplica.cardWidth - 240) < 0.001);
assert.ok(viewportReplica.cardHeight > 280);
assert.ok(viewportReplica.cardHeight < 320);

for (const viewportWidth of [320, 400, 512]) {
  const menuRight = viewportWidth - 12;
  const menuLeft = menuRight - 264;
  const placement = factory.computePreviewPlacement({
    viewportWidth,
    viewportHeight: 568,
    menuRect: { left: menuLeft, right: menuRight },
    itemRect: { top: 150 },
    previewWidth: 240,
    previewHeight: 202,
    margin: 12,
    gap: 8,
    minimumMenuHeight: 120,
  });
  assert.equal(placement.placement, "stacked");
  assert.ok(placement.left >= 12);
  assert.ok(placement.left + 240 <= viewportWidth - 12);
  assert.ok(placement.top + 202 + 8 <= placement.menuTop);
  assert.ok(placement.menuTop + placement.menuMaxHeight <= 568 - 12);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  const cleared = [];

  return {
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
      pending.delete(id);
    },
    run(id) {
      const timer = pending.get(id);
      if (!timer) return false;
      pending.delete(id);
      timer.callback();
      return true;
    },
    runAll() {
      for (const id of [...pending.keys()]) this.run(id);
    },
    ids() {
      return [...pending.keys()];
    },
    delays() {
      return [...pending.values()].map((timer) => timer.delay);
    },
    cleared,
  };
}

function createDeps(overrides = {}) {
  return {
    createViewer: async () => ({ id: "viewer" }),
    disposeViewer() {},
    startViewer() {},
    stopViewer() {},
    async renderPreview() {},
    async applyPreset() {},
    ...overrides,
  };
}

const tests = [];
function test(name, callback) {
  tests.push({ name, callback });
}

test("dispose during viewer creation disposes the stale viewer", async () => {
  const creation = deferred();
  const viewer = { id: "late-viewer" };
  const disposed = [];
  const started = [];
  const rendered = [];
  let createCount = 0;
  const controller = factory.create(createDeps({
    createViewer() {
      createCount += 1;
      return creation.promise;
    },
    disposeViewer(value) {
      disposed.push(value);
    },
    startViewer(value) {
      started.push(value);
    },
    renderPreview(value, payload) {
      rendered.push([value, payload]);
    },
  }));

  const request = controller.requestPreview({ id: "A" });
  await flushMicrotasks();
  assert.equal(createCount, 1);

  controller.dispose();
  creation.resolve(viewer);
  await flushMicrotasks();

  assert.deepEqual(disposed, [viewer]);
  assert.deepEqual(started, []);
  assert.deepEqual(rendered, []);
  controller.show();
  await flushMicrotasks();
  assert.deepEqual(started, []);
  await request;
});

test("a newer preview waits for stale work and reuses one retained viewer", async () => {
  const previewA = deferred();
  const viewers = [];
  const rendered = [];
  const disposed = [];
  const stopped = [];
  const controller = factory.create(createDeps({
    async createViewer() {
      const viewer = { id: `viewer-${viewers.length + 1}` };
      viewers.push(viewer);
      return viewer;
    },
    disposeViewer(viewer) {
      disposed.push(viewer);
    },
    stopViewer(viewer) {
      stopped.push(viewer);
    },
    renderPreview(viewer, payload) {
      rendered.push({ viewer, payload });
      if (payload.id === "A") return previewA.promise;
      return Promise.resolve(`rendered-${payload.id}`);
    },
  }));

  const requestA = controller.requestPreview({ id: "A" });
  await flushMicrotasks();
  assert.deepEqual(rendered.map((entry) => entry.payload.id), ["A"]);

  const requestB = controller.requestPreview({ id: "B" });
  await flushMicrotasks();
  assert.deepEqual(rendered.map((entry) => entry.payload.id), ["A"]);
  assert.equal(viewers.length, 1);

  previewA.resolve("late-A-result");
  await requestA;
  await flushMicrotasks();
  assert.deepEqual(rendered.map((entry) => entry.payload.id), ["A", "B"]);
  assert.equal(viewers.length, 1);
  assert.equal(rendered[1].viewer, viewers[0]);
  await requestB;

  controller.hide();
  assert.equal(stopped.at(-1), viewers[0]);
  controller.dispose();
  assert.deepEqual(disposed, [viewers[0]]);
});

test("hide during viewer creation skips rendering and schedules idle disposal", async () => {
  const creation = deferred();
  const timers = fakeTimers();
  const viewer = { id: "hidden-late-viewer" };
  const rendered = [];
  const disposed = [];
  const controller = factory.create(createDeps({
    createViewer: () => creation.promise,
    renderPreview(value, payload) {
      rendered.push([value, payload]);
    },
    disposeViewer(value) {
      disposed.push(value);
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  }), { idleDisposeMs: 250 });

  const request = controller.requestPreview({ id: "A" });
  await flushMicrotasks();
  controller.hide();
  creation.resolve(viewer);
  await request;
  await flushMicrotasks();

  assert.deepEqual(rendered, []);
  assert.deepEqual(timers.delays(), [250]);
  timers.runAll();
  assert.deepEqual(disposed, [viewer]);
  controller.dispose();
});

test("hide stops the viewer while show cancels idle disposal and restarts it", async () => {
  const timers = fakeTimers();
  const viewer = { id: "reusable-viewer" };
  const started = [];
  const stopped = [];
  const disposed = [];
  const controller = factory.create(createDeps({
    createViewer: async () => viewer,
    startViewer(value) {
      started.push(value);
    },
    stopViewer(value) {
      stopped.push(value);
    },
    disposeViewer(value) {
      disposed.push(value);
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  }), { idleDisposeMs: 250 });

  await controller.requestPreview({ id: "A" });
  assert.deepEqual(started, [viewer]);

  controller.hide();
  assert.deepEqual(stopped, [viewer]);
  assert.deepEqual(timers.delays(), [250]);
  const firstIdleTimer = timers.ids()[0];

  controller.show();
  assert.deepEqual(timers.cleared, [firstIdleTimer]);
  assert.deepEqual(started, [viewer, viewer]);
  assert.deepEqual(disposed, []);

  controller.hide();
  timers.runAll();
  await flushMicrotasks();
  assert.deepEqual(disposed, [viewer]);
  controller.dispose();
});

test("preset applies are serialized and duplicate pending requests coalesce", async () => {
  const applyA = deferred();
  const applyB = deferred();
  const applyCalls = [];
  let activeApplies = 0;
  let maximumActiveApplies = 0;
  const controller = factory.create(createDeps({
    applyPreset(payload) {
      applyCalls.push(payload.id);
      activeApplies += 1;
      maximumActiveApplies = Math.max(maximumActiveApplies, activeApplies);
      const operation = payload.id === "A" ? applyA : applyB;
      return operation.promise.finally(() => {
        activeApplies -= 1;
      });
    },
  }));

  const requestA = controller.requestApply({ id: "A" });
  const requestB = controller.requestApply({ id: "B" });
  const duplicateB = controller.requestApply({ id: "B" });
  await flushMicrotasks();
  assert.deepEqual(applyCalls, ["A"]);
  assert.equal(maximumActiveApplies, 1);

  applyA.resolve("applied-A");
  await requestA;
  await flushMicrotasks();
  assert.deepEqual(applyCalls, ["A", "B"]);
  assert.equal(maximumActiveApplies, 1);

  applyB.resolve("applied-B");
  await Promise.all([requestB, duplicateB]);
  assert.deepEqual(applyCalls, ["A", "B"]);
  assert.equal(applyCalls.at(-1), "B");
  assert.equal(maximumActiveApplies, 1);
  controller.dispose();
});

test("the last A in an A to B to A sequence wins", async () => {
  const firstA = deferred();
  const lastA = deferred();
  const applyCalls = [];
  let aCalls = 0;
  const controller = factory.create(createDeps({
    applyPreset(payload) {
      applyCalls.push(payload.id);
      if (payload.id !== "A") return Promise.resolve(`applied-${payload.id}`);
      aCalls += 1;
      return aCalls === 1 ? firstA.promise : lastA.promise;
    },
  }));

  const requestFirstA = controller.requestApply({ id: "A" });
  const requestB = controller.requestApply({ id: "B" });
  const requestLastA = controller.requestApply({ id: "A" });
  await flushMicrotasks();
  assert.deepEqual(applyCalls, ["A"]);
  assert.equal(await requestB, undefined);

  firstA.resolve("first-A");
  await requestFirstA;
  await flushMicrotasks();
  assert.deepEqual(applyCalls, ["A", "A"]);

  lastA.resolve("last-A");
  assert.equal(await requestLastA, "last-A");
  assert.equal(applyCalls.at(-1), "A");
  controller.dispose();
});

test("dispose clears idle timers and drops queued mutations", async () => {
  const timers = fakeTimers();
  const viewer = { id: "disposable-viewer" };
  const applyA = deferred();
  const applyCalls = [];
  const disposed = [];
  const controller = factory.create(createDeps({
    createViewer: async () => viewer,
    disposeViewer(value) {
      disposed.push(value);
    },
    applyPreset(payload) {
      applyCalls.push(payload.id);
      return payload.id === "A" ? applyA.promise : Promise.resolve();
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  }), { idleDisposeMs: 100 });

  await controller.requestPreview({ id: "preview" });
  controller.hide();
  const idleTimer = timers.ids()[0];
  assert.ok(idleTimer);

  const requestA = controller.requestApply({ id: "A" });
  const requestB = controller.requestApply({ id: "B" });
  await flushMicrotasks();
  assert.deepEqual(applyCalls, ["A"]);

  controller.dispose();
  assert.deepEqual(timers.cleared, [idleTimer]);
  assert.deepEqual(disposed, [viewer]);
  assert.equal(timers.ids().length, 0);

  applyA.resolve("late-A-result");
  await Promise.all([requestA, requestB]);
  await flushMicrotasks();
  assert.deepEqual(applyCalls, ["A"]);
  assert.deepEqual(disposed, [viewer]);
});

for (const { name, callback } of tests) {
  await callback();
  console.log(`ok - ${name}`);
}

console.log("molstar preset preview controller tests passed");
