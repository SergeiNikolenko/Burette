import { invoke } from "@tauri-apps/api/core";

// Journey marks for performance work. Inactive unless the app was started
// with BURETTE_PERF_TRACE=1: the Rust side then defines
// window.__BURETTE_PERF_TRACE__ and each mark goes to PerfTrace.jsonl next to
// the IPC timings. `at` is Unix milliseconds, the clock Rust stamps its lines
// with, so one journey reads across the shell, the viewer frames and Rust.

declare global {
  interface Window {
    __BURETTE_PERF_TRACE__?: boolean;
  }
}

type PerfTraceEntry = {
  at: number;
  name: string;
  ms?: number;
  detail?: Record<string, unknown>;
};

const FLUSH_DELAY_MS = 1000;
const MAX_PENDING = 2000;

let pending: PerfTraceEntry[] = [];
let flushTimer: number | null = null;

export const perfTraceEnabled = typeof window !== "undefined" && window.__BURETTE_PERF_TRACE__ === true;

export function perfNow() {
  return performance.timeOrigin + performance.now();
}

/** Converts a DOM event timestamp to the shared Unix-millisecond clock. */
export function perfEventTime(event: Event) {
  return performance.timeOrigin + event.timeStamp;
}

function flush() {
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = null;
  if (pending.length === 0) return;
  const entries = pending;
  pending = [];
  void invoke("append_perf_trace", { entries }).catch(() => {});
}

export function tracePerf(name: string, fields: { at?: number; ms?: number; detail?: Record<string, unknown> } = {}) {
  if (!perfTraceEnabled) return;
  const entry: PerfTraceEntry = { at: fields.at ?? perfNow(), name };
  if (fields.ms !== undefined) entry.ms = Math.round(fields.ms * 1000) / 1000;
  if (fields.detail) entry.detail = fields.detail;
  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push(entry);
  if (flushTimer === null) flushTimer = window.setTimeout(flush, FLUSH_DELAY_MS);
}

export function installPerfTrace() {
  if (!perfTraceEnabled) return;
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  void import("./perf-journeys").then(module => module.installPerfJourneys());
}
