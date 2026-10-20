import { invoke } from "@tauri-apps/api/core";

// Journey marks for performance work. Inactive unless the app was started
// with BURETTE_PERF_TRACE=1: the Rust side then defines
// window.__BURETTE_PERF_TRACE__ and each mark goes to PerfTrace.jsonl next to
// the IPC timings. `at` is Unix milliseconds, the clock Rust stamps its lines
// with, so one journey reads across the shell, the viewer frames and Rust.

declare global {
  interface Window {
    __BURETTE_PERF_TRACE__?: boolean;
    __BURETTE_PERF_TRACE_GENERATION__?: number;
  }
}

type PerfTraceEntry = {
  at: number;
  name: string;
  seq?: number;
  stream: string;
  ms?: number;
  detail?: Record<string, unknown>;
};

const FLUSH_DELAY_MS = 1000;
const MAX_PENDING = 2000;
// Keep this aligned with MAX_ENTRIES_PER_BATCH in perf_trace.rs.
const MAX_BATCH = 400;
const MAX_NAME_CHARS = 96;
// Bound work before serialization as well as retained/IPC detail bytes. Native
// details allow 2048 characters; transport diagnostics have six numeric fields.
const MAX_DETAIL_BYTES = 2048;
const MAX_DETAIL_DEPTH = 8;
const MAX_DETAIL_NODES = 128;
const MAX_DETAIL_KEYS = 64;
const DETAIL_TRUNCATED = Symbol("trace detail exceeds its budget");
const DETAIL_INVALID = Symbol("trace detail is not JSON data");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function snapshotDetail(detail: Record<string, unknown>): Record<string, unknown> {
  let nodes = 0;
  let keys = 0;
  let characters = 0;
  const ancestors = new Set<object>();
  const countCharacters = (value: string) => {
    characters += value.length;
    if (characters > MAX_DETAIL_BYTES) throw DETAIL_TRUNCATED;
    // JSON.stringify escapes lone UTF-16 surrogates, which Rust rejects.
    if (decoder.decode(encoder.encode(value)) !== value) throw DETAIL_INVALID;
  };
  const visit = (value: unknown, depth: number): JsonValue => {
    if (++nodes > MAX_DETAIL_NODES || depth > MAX_DETAIL_DEPTH) throw DETAIL_TRUNCATED;
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") { countCharacters(value); return value; }
    if (typeof value !== "object" || ancestors.has(value)) throw DETAIL_INVALID;
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== null && prototype !== Object.prototype) throw DETAIL_INVALID;
    ancestors.add(value);
    let result: JsonValue;
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value as number;
      if (length > MAX_DETAIL_NODES) throw DETAIL_TRUNCATED;
      const items: JsonValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor && !("value" in descriptor)) throw DETAIL_INVALID;
        items.push(descriptor?.value === undefined ? null : visit(descriptor.value, depth + 1));
      }
      result = items;
    } else {
      const properties: { [key: string]: JsonValue } = Object.create(null);
      for (const key in value) {
        if (++keys > MAX_DETAIL_KEYS) throw DETAIL_TRUNCATED;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) continue;
        if (!("value" in descriptor)) throw DETAIL_INVALID;
        countCharacters(key);
        if (descriptor.value === undefined) continue;
        properties[key] = visit(descriptor.value, depth + 1);
      }
      result = properties;
    }
    ancestors.delete(value);
    return result;
  };
  try {
    const snapshot = visit(detail, 0) as Record<string, unknown>;
    // Only the bounded, getter/toJSON-free snapshot reaches JSON.stringify.
    if (encoder.encode(JSON.stringify(snapshot)).length > MAX_DETAIL_BYTES) throw DETAIL_TRUNCATED;
    return snapshot;
  } catch (error) {
    if (error === DETAIL_TRUNCATED) return { truncated: true };
    throw error;
  }
}

const pending: PerfTraceEntry[] = [];
let flushTimer: number | null = null;
let flushing = false;
let sequence = 0;
let droppedEntries = 0;
let lastDroppedSequence = 0;
let failedBatches = 0;
let totalDroppedEntries = 0;
let totalFailedBatches = 0;
export const perfTraceEnabled = typeof window !== "undefined" && window.__BURETTE_PERF_TRACE__ === true;
const stream = perfTraceEnabled ? createStream() : "";

function createStream() {
  // Keep module/HMR generations distinct even without secure-context UUIDs.
  const generation = (window.__BURETTE_PERF_TRACE_GENERATION__ ?? 0) + 1;
  window.__BURETTE_PERF_TRACE_GENERATION__ = generation;
  const nonce = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${performance.timeOrigin}:${generation}:${nonce}`;
}

export function perfNow() {
  const at = performance.timeOrigin + performance.now();
  return Number.isFinite(at) ? at : Date.now();
}

/** Converts a DOM event timestamp to the shared Unix-millisecond clock. */
export function perfEventTime(event: Event) {
  return performance.timeOrigin + event.timeStamp;
}

function scheduleFlush() {
  if (flushTimer === null && !flushing) flushTimer = window.setTimeout(flush, FLUSH_DELAY_MS);
}

async function flush() {
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = null;
  if (flushing) return;
  flushing = true;
  try {
    while (pending.length > 0 || droppedEntries > 0 || failedBatches > 0) {
      const reportedDrops = droppedEntries;
      const reportedFailures = failedBatches;
      const diagnostic = reportedDrops > 0 || reportedFailures > 0;
      const count = Math.min(pending.length, MAX_BATCH - Number(diagnostic));
      const entries = pending.slice(0, count);
      if (diagnostic) entries.push({
        at: perfNow(), name: "trace:transport", stream,
        detail: {
          droppedEntries: reportedDrops, totalDroppedEntries, lastDroppedSequence,
          failedBatches: reportedFailures, totalFailedBatches, pendingEntries: pending.length,
        },
      });
      try {
        await invoke("append_perf_trace", { entries });
      } catch {
        // Keep unacknowledged entries and retry on the next timer, not in a
        // tight loop. A lost acknowledgement can replay a sequence number.
        failedBatches += 1;
        totalFailedBatches += 1;
        break;
      }
      pending.splice(0, count);
      droppedEntries -= reportedDrops;
      failedBatches -= reportedFailures;
    }
  } finally {
    flushing = false;
    if (pending.length > 0 || droppedEntries > 0 || failedBatches > 0) scheduleFlush();
  }
}

export function tracePerf(name: string, fields: { at?: number; ms?: number; detail?: Record<string, unknown> } = {}) {
  if (!perfTraceEnabled) return;
  const seq = ++sequence;
  const drop = () => {
    droppedEntries += 1;
    totalDroppedEntries += 1;
    lastDroppedSequence = seq;
    scheduleFlush();
  };
  if (pending.length >= MAX_PENDING) {
    drop();
    return;
  }
  try {
    const at = fields.at ?? perfNow();
    if (typeof name !== "string" || !Number.isFinite(at) || (fields.ms !== undefined && !Number.isFinite(fields.ms))) throw DETAIL_INVALID;
    const entry: PerfTraceEntry = { at, name: decoder.decode(encoder.encode(name.slice(0, MAX_NAME_CHARS))), seq, stream };
    if (fields.ms !== undefined) {
      const rounded = Math.round(fields.ms * 1000) / 1000;
      entry.ms = Number.isFinite(rounded) ? rounded : fields.ms;
    }
    if (fields.detail) entry.detail = snapshotDetail(fields.detail);
    pending.push(entry);
  } catch {
    drop();
    return;
  }
  scheduleFlush();
}

export function installPerfTrace() {
  if (!perfTraceEnabled) return;
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  void import("./perf-journeys").then(module => module.installPerfJourneys());
}
