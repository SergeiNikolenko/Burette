import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window({ url: "https://localhost" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLFormElement", "HTMLInputElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "getComputedStyle", "CustomEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? browser : browser[key] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { mockIPC, clearMocks } = await import("@tauri-apps/api/mocks");
const { emit } = await import("@tauri-apps/api/event");
const { createRoot } = await import("react-dom/client");
const { UsageStatistics } = await import("../apps/desktop/src/components/usage-statistics");
const { startUsageStatistics, recordStatisticsError } = await import("../apps/desktop/src/lib/usage-statistics");
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("consent UI refuses without events, enables explicitly, sends categories and shows offline erasure", async () => {
  let state = { available: true, decided: false, enabled: false, pendingErasure: false, noticeUrl: "https://example.org/privacy" };
  const events: unknown[] = [];
  const choices: unknown[] = [];
  let offline = false;
  let delayStatus = false;
  let releaseStatus: (() => void) | undefined;
  mockIPC((command, args) => {
    if (command === "statistics_status") {
      const snapshot = { ...state };
      if (delayStatus) {
        delayStatus = false;
        return new Promise(resolve => { releaseStatus = () => resolve(snapshot); });
      }
      return snapshot;
    }
    if (command === "statistics_consent") {
      choices.push(args?.enabled);
      state = { ...state, decided: true, enabled: args?.enabled as boolean, pendingErasure: !args?.enabled && state.enabled };
      return { ...state };
    }
    if (command === "statistics_record") { events.push(args?.event); return; }
    if (command === "statistics_flush") {
      if (offline) throw new Error("offline");
      state.pendingErasure = false;
      return;
    }
    if (command === "plugin:event|listen") return 1;
    if (command === "plugin:event|unlisten") return;
    throw new Error(`Unexpected IPC: ${command}`);
  }, { shouldMockEvents: true });
  const shell = document.createElement("div");
  document.body.append(shell);
  const root = createRoot(shell);
  let stop = () => {};
  const button = (label: string) => [...shell.querySelectorAll("button")].find(node => node.textContent === label)!;
  try {
    await act(async () => { stop = startUsageStatistics(); root.render(<UsageStatistics pageKind="ketcher" />); await settle(); });
    expect(events).toEqual([]);
    expect(button("Don’t share").className).toBe(button("Share statistics").className);
    await act(async () => { button("Don’t share").click(); await settle(); });
    expect(choices).toEqual([false]);
    expect(events).toEqual([]);
    expect(shell.querySelector("section")).toBeNull();
    await act(async () => root.render(<UsageStatistics settings />));
    const toggle = () => shell.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    await act(async () => { toggle().click(); await settle(); });
    expect(choices).toEqual([false, true]);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    recordStatisticsError("network failed /Users/private/molecule.sdf");
    await settle();
    expect(events).toContainEqual({ kind: "error", value: "network" });
    expect(JSON.stringify(events)).not.toContain("private");
    offline = true;
    await act(async () => { toggle().click(); await settle(); });
    expect(toggle().disabled).toBe(true);
    expect(shell.textContent).toContain("Deletion is pending");
    const before = events.length;
    recordStatisticsError("private parse error");
    expect(events.length).toBe(before);
    offline = false;
    await act(async () => { button("Retry deletion").click(); await settle(); });
    expect(toggle().disabled).toBe(false);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    // Another window changes consent. A delayed older response must not win.
    state.enabled = true;
    await act(async () => { await emit("statistics-consent-changed"); await settle(); });
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    delayStatus = true;
    await act(async () => { await emit("statistics-consent-changed"); });
    state.enabled = false;
    await act(async () => { await emit("statistics-consent-changed"); await settle(); releaseStatus!(); await settle(); });
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  } finally {
    await act(async () => { stop(); root.unmount(); });
    shell.remove();
    clearMocks();
  }
});

test("ordinary browser runtime starts no native statistics", () => {
  let calls = 0;
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: undefined });
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  const original = window.setInterval;
  window.setInterval = (() => { calls++; return 1; }) as typeof window.setInterval;
  try { startUsageStatistics()(); expect(calls).toBe(0); }
  finally { window.setInterval = original; }
});
