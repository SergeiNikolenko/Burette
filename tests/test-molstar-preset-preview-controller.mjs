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

for (const [cropWidth, cropHeight] of [[200, 600], [400, 400], [600, 200]]) {
  const layout = factory.computePreviewCanvasLayout({
    cropWidth,
    cropHeight,
    viewportWidth: 948,
    viewportHeight: 994,
    devicePixelRatio: 2,
  });
  assert.equal(layout.cardWidth, 240);
  assert.equal(layout.cardHeight, 202);
  assert.ok(layout.drawWidth <= 220);
  assert.ok(layout.drawHeight <= 154);
  assert.ok(layout.drawX >= 10);
  assert.ok(layout.drawY >= 10);
}

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
