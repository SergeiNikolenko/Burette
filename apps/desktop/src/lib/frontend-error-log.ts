import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./tauri";

// WKWebView prints its console nowhere in a packaged app, so an uncaught
// frontend error is visible only on screen and only for a moment. Everything
// that reaches console.error, window.onerror or an unhandled rejection is
// forwarded to the app log the diagnostics bundle already ships.
//
// The forwarder must never become the story itself: it is capped per session,
// fire-and-forget, and a failure to log is swallowed.
const SESSION_LIMIT = 200;
let forwarded = 0;

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`.trim();
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function forward(event: string, parts: unknown[]) {
  if (forwarded >= SESSION_LIMIT) return;
  forwarded += 1;
  const message = parts.map(describe).join(" ").slice(0, 4096);
  if (!message.trim()) return;
  void invoke("frontend_log", { level: "error", event, message }).catch(() => {});
}

export function installFrontendErrorLog() {
  if (!isTauriRuntime()) return;
  const original = console.error.bind(console);
  console.error = (...parts: unknown[]) => {
    original(...parts);
    forward("console-error", parts);
  };
  window.addEventListener("error", (event) => {
    forward("window-error", [event.message, event.filename, event.error]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    forward("unhandled-rejection", [event.reason]);
  });
}
