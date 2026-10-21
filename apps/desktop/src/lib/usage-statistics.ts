import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime, trackTauriListener } from "./tauri";
import { isNativePreviewWindow } from "./window-scope";

type Status = {
  available: boolean;
  decided: boolean;
  enabled: boolean;
  pendingErasure: boolean;
  noticeUrl: string | null;
};
type Feature = "structure" | "table" | "editor" | "trajectory" | "docking" | "compute" | "files" | "export";
type ErrorCategory = "network" | "parse" | "render" | "timeout" | "permission" | "unsupported" | "unknown";
type StatisticsEvent = { kind: "active"; value: "day" } | { kind: "feature"; value: Feature } | { kind: "error"; value: ErrorCategory };
const unavailableStatus: Status = { available: false, decided: false, enabled: false, pendingErasure: false, noticeUrl: null };
let status = unavailableStatus;
const subscribers = new Set<() => void>();
let revision = 0;
let running = false;
let flushing = false;

function publish(next: Status) {
  status = next;
  subscribers.forEach(notify => notify());
}
function supported() {
  return isTauriRuntime() && !isNativePreviewWindow() && !window.BuretteMcpWorkspace;
}
function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
}
export function useUsageStatistics() {
  return useSyncExternalStore(subscribe, () => status, () => unavailableStatus);
}
async function refresh() {
  const ticket = ++revision;
  try {
    const next = await invoke<Status>("statistics_status");
    if (running && ticket === revision) publish(next);
  } catch { /* Optional statistics must never interrupt the app. */ }
}
function record(event: StatisticsEvent) {
  if (running && status.enabled) void invoke("statistics_record", { event }).catch(() => {});
}
export function recordStatisticsFeature(value: Feature) {
  record({ kind: "feature", value });
}
export function recordStatisticsError(message: string) {
  // Inspect locally; only the closed category crosses IPC. Never send the text.
  const value: ErrorCategory = /timeout|timed out/i.test(message) ? "timeout"
    : /permission|access denied/i.test(message) ? "permission"
    : /network|fetch|connection/i.test(message) ? "network"
    : /parse|syntax/i.test(message) ? "parse"
    : /render|webgl|canvas/i.test(message) ? "render"
    : /unsupported|not supported/i.test(message) ? "unsupported" : "unknown";
  record({ kind: "error", value });
}
export async function flushUsageStatistics() {
  if (!running || flushing || (!status.enabled && !status.pendingErasure)) return;
  flushing = true;
  try { await invoke("statistics_flush"); }
  finally { flushing = false; await refresh(); }
}
export async function chooseUsageStatistics(enabled: boolean) {
  ++revision;
  if (!enabled) publish({ ...status, enabled: false });
  try {
    await invoke("statistics_consent", { enabled });
  } finally { await refresh(); }
  if (enabled) record({ kind: "active", value: "day" });
  // A failed upload/erasure is retried later; consent itself has been saved.
  void flushUsageStatistics().catch(() => {});
}
export function startUsageStatistics() {
  if (!supported()) return () => {};
  running = true;
  const stopListening = trackTauriListener(
    listen("statistics-consent-changed", () => { void refresh(); }),
    "statistics consent",
  );
  const tick = () => {
    if (document.visibilityState === "visible" && document.hasFocus()) record({ kind: "active", value: "day" });
    void flushUsageStatistics().catch(() => {});
  };
  void refresh().then(tick);
  const timer = window.setInterval(tick, 60_000);
  window.addEventListener("online", tick);
  return () => {
    running = false;
    ++revision;
    stopListening();
    window.clearInterval(timer);
    window.removeEventListener("online", tick);
  };
}
