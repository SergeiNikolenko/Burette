#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mockIPC } from "@tauri-apps/api/mocks";
import { writeClipboardText } from "../apps/desktop/src/lib/clipboard.ts";

const originalWindow = globalThis.window;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
try {
  globalThis.window = {};
  const writes = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error("No user gesture"); } } },
  });
  mockIPC((command, payload) => { writes.push({ command, payload }); });
  await Promise.resolve(); // Copy can finish after a viewer response.
  await writeClipboardText("GA\nαβ");
  await writeClipboardText("");
  assert.deepEqual(writes, [
    { command: "write_clipboard_text", payload: { text: "GA\nαβ" } },
    { command: "write_clipboard_text", payload: { text: "" } },
  ]);
  mockIPC(() => { throw new Error("Pasteboard unavailable"); });
  await assert.rejects(writeClipboardText("GA"), /Pasteboard unavailable/);

  globalThis.window = {};
  navigator.clipboard.writeText = async (text) => { writes.push(text); };
  await writeClipboardText("browser sequence");
  assert.equal(writes.at(-1), "browser sequence");
} finally {
  globalThis.window = originalWindow;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
}
console.log("Clipboard native IPC and browser routing passed");
