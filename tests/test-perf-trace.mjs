#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFileSync, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import ts from "typescript-compiler-api";

// Exercise the production transport with controlled acknowledgements/timers.
// The private flush is exposed only by this test loader, not by the app.
const source = readFileSync(new URL("../apps/desktop/src/lib/perf-trace.ts", import.meta.url), "utf8")
  .replace(/^import .*;\n/m, "")
  .replace(/^export /gm, "");
const load = new Function("invoke", "window", "performance", "globalThis", ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText + "\nreturn { tracePerf, flush };");

function harness(send = async () => {}, enabled = true, { globals = globalThis, state = {} } = {}) {
  const timers = new Map();
  const batches = [];
  let timer = 0;
  let outstanding = 0;
  let peakOutstanding = 0;
  const api = load(async (command, { entries }) => {
    assert.equal(command, "append_perf_trace");
    assert.ok(entries.length <= 400, "every request fits the native batch contract");
    for (const entry of entries) {
      assert.ok(Number.isFinite(entry.at));
      assert.ok(entry.ms === undefined || Number.isFinite(entry.ms));
      assert.ok(entry.name.length <= 96);
      assert.ok(entry.stream.length <= 96);
      if (entry.detail) assert.ok(Buffer.byteLength(JSON.stringify(entry.detail)) <= 2048);
    }
    const received = JSON.parse(JSON.stringify(entries));
    batches.push(received);
    outstanding += 1;
    peakOutstanding = Math.max(peakOutstanding, outstanding);
    try { await send(received); }
    finally { outstanding -= 1; }
  }, Object.assign(state, {
    __BURETTE_PERF_TRACE__: enabled,
    setTimeout(fn) { timers.set(++timer, fn); return timer; },
    clearTimeout(id) { timers.delete(id); },
  }), { timeOrigin: 12345, now: () => 67 }, globals);
  return { ...api, timers, batches, peak: () => peakOutstanding };
}

function burst(app, count) {
  for (let i = 0; i < count; i += 1) app.tracePerf("document:added", { detail: { index: i } });
}
const events = entries => entries.filter(entry => entry.name === "document:added");
const diagnostics = entries => entries.filter(entry => entry.name === "trace:transport");
const sequences = entries => events(entries).map(entry => entry.seq);
const range = count => Array.from({ length: count }, (_, index) => index + 1);

{
  const app = harness();
  burst(app, 1201);
  assert.equal(app.timers.size, 1);
  await app.flush();
  assert.deepEqual(sequences(app.batches.flat()), range(1201));
  assert.deepEqual(app.batches.map(batch => batch.length), [400, 400, 400, 1]);
  const streams = new Set(app.batches.flat().map(entry => entry.stream));
  assert.equal(streams.size, 1);
  assert.ok([...streams][0].startsWith("12345:"));
  assert.equal(app.peak(), 1);
  assert.equal(app.timers.size, 0);
}

{
  const first = harness();
  const reloaded = harness(); // Both loaders deliberately share timeOrigin.
  burst(first, 1);
  burst(reloaded, 1);
  await first.flush();
  await reloaded.flush();
  assert.equal(first.batches[0][0].seq, 1);
  assert.equal(reloaded.batches[0][0].seq, 1);
  assert.notEqual(first.batches[0][0].stream, reloaded.batches[0][0].stream);
}

{
  const disabled = harness(undefined, false, {
    globals: Object.defineProperty({}, "crypto", { get() { throw new Error("disabled tracing read crypto"); } }),
  });
  burst(disabled, 1);
  await disabled.flush();
  assert.equal(disabled.batches.length, 0);

  // Older WebKit/insecure contexts may expose neither crypto nor randomUUID.
  for (const globals of [{}, { crypto: {} }, { crypto: { randomUUID: () => "same-nonce" } }]) {
    const state = {};
    const first = harness(undefined, true, { globals, state });
    const reloaded = harness(undefined, true, { globals, state });
    burst(first, 1);
    burst(reloaded, 1);
    await first.flush();
    await reloaded.flush();
    assert.equal(first.batches[0][0].seq, 1);
    assert.equal(reloaded.batches[0][0].seq, 1);
    assert.notEqual(first.batches[0][0].stream, reloaded.batches[0][0].stream);
  }
}

{
  const app = harness();
  app.tracePerf("document:added");
  const cycle = {};
  cycle.self = cycle;
  let executed = 0;
  const getter = Object.defineProperty({}, "unsafe", { enumerable: true, get() { executed += 1; return 1; } });
  for (const fields of [
    { detail: { number: 1n } }, { detail: cycle }, { at: NaN }, { ms: NaN },
    { detail: { number: NaN } }, { detail: getter }, { detail: { toJSON() { executed += 1; return {}; } } },
  ]) app.tracePerf("document:added", fields);
  const original = { nested: { value: "before" }, optional: undefined, items: [undefined, 2] };
  app.tracePerf("document:added", { detail: original });
  original.nested.value = "after";
  await app.flush();
  const accepted = app.batches.flat();
  assert.deepEqual(sequences(accepted), [1, 9], "invalid entries cannot poison valid neighbours");
  assert.deepEqual(events(accepted)[1].detail, { nested: { value: "before" }, items: [null, 2] });
  assert.equal(executed, 0, "snapshotting never invokes getters or toJSON");
  assert.equal(diagnostics(accepted)[0].detail.droppedEntries, 7);
  assert.equal(diagnostics(accepted)[0].detail.lastDroppedSequence, 8);
  assert.equal(app.timers.size, 0, "permanent payload errors must not schedule retries");
}

{
  const app = harness();
  let deep = { value: true };
  for (let depth = 0; depth < 16; depth += 1) deep = { child: deep };
  for (const detail of [
    { value: "x".repeat(100_000) },
    Object.fromEntries(range(65).map(key => [key, true])),
    deep,
    { values: Array.from({ length: 128 }, () => true) },
    { value: "😀".repeat(512) }, // Character budget fits; UTF-8 byte budget does not.
  ]) app.tracePerf("document:added", { detail });
  await app.flush();
  assert.deepEqual(sequences(app.batches.flat()), range(5));
  assert.ok(events(app.batches.flat()).every(entry => entry.detail.truncated === true));
  assert.equal(diagnostics(app.batches.flat()).length, 0, "bounded details retain their valid marks");
}

{
  const app = harness();
  app.tracePerf("document:added", { detail: { value: "\ud800" } });
  app.tracePerf("x".repeat(95) + "😀");
  await app.flush();
  assert.equal(diagnostics(app.batches.flat())[0].detail.droppedEntries, 1);
  const mark = app.batches.flat().find(entry => entry.seq === 2);
  assert.equal(mark.name, "x".repeat(95) + "\ufffd", "bounded names cannot send an isolated surrogate to Rust");
}

{
  let release;
  const accepted = [];
  const gate = new Promise(resolve => { release = resolve; });
  const app = harness(async entries => { await gate; accepted.push(...entries); });
  burst(app, 200);
  const drain = app.flush();
  burst(app, 1300);
  await app.flush(); // pagehide/visibility flush during an in-flight request
  assert.equal(app.batches.length, 1);
  release();
  await drain;
  assert.deepEqual(sequences(accepted), range(1500));
  assert.equal(app.peak(), 1);
}

{
  let attempts = 0;
  const accepted = [];
  const app = harness(async entries => {
    if (++attempts <= 3) throw new Error("IPC unavailable");
    accepted.push(...entries);
  });
  burst(app, 1200);
  for (let i = 0; i < 3; i += 1) {
    await app.flush();
    assert.equal(app.batches.length, i + 1, "a failure waits for retry, without spinning");
    assert.equal(app.timers.size, 1);
    assert.equal(accepted.length, 0);
  }
  await app.flush();
  assert.deepEqual(sequences(accepted), range(1200));
  assert.equal(diagnostics(accepted).reduce((sum, entry) => sum + entry.detail.failedBatches, 0), 3);
  assert.equal(app.peak(), 1);
  assert.equal(app.timers.size, 0);
}

{
  let release;
  const accepted = [];
  const gate = new Promise(resolve => { release = resolve; });
  const app = harness(async entries => { await gate; accepted.push(...entries); });
  burst(app, 3000);
  const drain = app.flush();
  burst(app, 100); // In-flight entries still count against the queue bound.
  release();
  await drain;
  assert.deepEqual(sequences(accepted), range(2000));
  assert.equal(diagnostics(accepted).reduce((sum, entry) => sum + entry.detail.droppedEntries, 0), 1100);
  assert.equal(diagnostics(accepted).at(-1).detail.lastDroppedSequence, 3100);
  assert.equal(diagnostics(accepted).at(-1).detail.totalDroppedEntries, 1100);
  burst(app, 1);
  await app.flush();
  assert.equal(sequences(accepted).at(-1), 3101, "sequence gaps make overflow externally detectable");
}

{
  // A receiver may accept a batch but lose its acknowledgement. Replays keep
  // the original stream/seq, allowing reducers to identify duplicates.
  const accepted = [];
  let fail = true;
  const app = harness(async entries => {
    accepted.push(...entries);
    if (fail) { fail = false; throw new Error("lost acknowledgement"); }
  });
  burst(app, 1100);
  await app.flush();
  await app.flush();
  assert.deepEqual([...new Set(sequences(accepted))], range(1100));
  assert.equal(events(accepted).length, 1500);
}

{
  const app = harness(undefined, false);
  burst(app, 1200);
  await app.flush();
  assert.equal(app.batches.length, 0);
  assert.equal(app.timers.size, 0);
}

{
  const runner = readFileSync(new URL("../scripts/perf-journey-app.mjs", import.meta.url), "utf8");
  const dependencies = { fstatSync, Buffer, StringDecoder, openSync, readSync, closeSync, appendFileSync };
  const Trace = new Function(...Object.keys(dependencies),
    runner.slice(runner.indexOf("class Trace {"), runner.indexOf("\nexport class PerfApp")) + "\nreturn Trace;",
  )(...Object.values(dependencies));
  const dir = mkdtempSync(join(tmpdir(), "burette-perf-trace-test-"));
  try {
    const path = join(dir, "PerfTrace.jsonl");
    const lines = range(1200).map(seq => ({ at: 100, source: "web", name: "document:added", window: "main", stream: "one", seq }));
    const diagnostic = { at: 100, source: "web", name: "trace:transport", window: "main", stream: "one", detail: { totalDroppedEntries: 8, totalFailedBatches: 1 } };
    // Simulate acceptance followed by a lost acknowledgement and chunk retry.
    const wire = [...lines.slice(0, 400), ...lines, diagnostic, diagnostic,
      { at: 100, source: "web", name: "legacy" }, { at: 100, source: "web", name: "legacy" }];
    writeFileSync(path, wire.map(line => JSON.stringify(line)).join("\n") + "\n");
    const trace = new Trace(path);
    trace.captureFrom = 0;
    trace.sync();
    trace.sync();
    assert.deepEqual(sequences(trace.lines), range(1200));
    assert.equal(trace.lines.filter(line => line.name === "legacy").length, 2);
    assert.deepEqual(trace.diagnostics, { droppedEntries: 8, failedBatches: 1, duplicateEntries: 400, malformedLines: 0, rotationGaps: 0 });
    appendFileSync(path, JSON.stringify({ ...diagnostic, detail: { totalDroppedEntries: 10, totalFailedBatches: 2 } }) + "\n");
    trace.sync();
    assert.equal(trace.diagnostics.droppedEntries, 10);
    assert.equal(trace.diagnostics.failedBatches, 2);
    trace.forget(101);
    appendFileSync(path, JSON.stringify(lines[0]) + "\n");
    trace.sync();
    assert.equal(trace.lines.length, 0, "forgetting a reporting interval must not allow an old replay");
    assert.equal(trace.diagnostics.duplicateEntries, 401);

    const unicode = Buffer.from(JSON.stringify({ ...lines[0], seq: 1201, name: "молекула" }) + "\n");
    const split = unicode.indexOf(Buffer.from("м")) + 1;
    appendFileSync(path, unicode.subarray(0, split));
    trace.sync();
    appendFileSync(path, unicode.subarray(split));
    appendFileSync(path, JSON.stringify({ ...lines[0], seq: 1202 }) + "\n");
    renameSync(path, join(dir, "PerfTrace.1.jsonl"));
    writeFileSync(path, JSON.stringify({ ...lines[0], seq: 1203 }) + "\n");
    trace.sync();
    assert.deepEqual(trace.lines.map(line => [line.seq, line.name]), [[1201, "молекула"], [1202, "document:added"], [1203, "document:added"]]);
    assert.equal(trace.diagnostics.rotationGaps, 0, "unread archive tails are retained across rotation");
    assert.equal(trace.diagnostics.malformedLines, 0, "split UTF-8 survives polling and rotation");

    // An archive overwritten by two rotations cannot be recovered; report it.
    renameSync(path, join(dir, "elsewhere.jsonl"));
    writeFileSync(path, JSON.stringify({ ...lines[0], seq: 1204 }) + "\n");
    trace.sync();
    assert.equal(trace.diagnostics.rotationGaps, 1);

    let race = true;
    const RaceTrace = new Function(...Object.keys(dependencies),
      runner.slice(runner.indexOf("class Trace {"), runner.indexOf("\nexport class PerfApp")) + "\nreturn Trace;",
    )(...Object.values({ ...dependencies, openSync: (...args) => {
      const fd = openSync(...args);
      if (race && args[0] === path) {
        race = false;
        renameSync(path, join(dir, "PerfTrace.1.jsonl"));
        writeFileSync(path, JSON.stringify({ ...lines[0], seq: 1205 }) + "\n");
      }
      return fd;
    }, readSync: (fd, buffer, offset, length, position) => readSync(fd, buffer, offset, Math.min(length, 17), position) }));
    const raced = new RaceTrace(path);
    raced.sync();
    raced.sync();
    assert.deepEqual(raced.lines.map(line => line.seq), [1204, 1205]);
    assert.equal(raced.diagnostics.malformedLines, 0);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

console.log("performance trace conservation tests passed");
