#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mock } from "bun:test";

const notices = [], calls = [], snapshots = [], closed = [];
let reject = true;
const saved = { revision: 42, documents: [] };
mock.module("@tauri-apps/api/core", () => ({ invoke: async command => {
  calls.push(command);
  if (reject) throw new Error("Recent documents update queue is full or unavailable");
  return saved;
} }));
mock.module("../apps/desktop/src/components/ui/toast", () => ({ toast: {
  add: notice => { notices.push(notice); return notices.length; },
  close: notice => closed.push(notice),
} }));
const { clearNativeRecentStructures } = await import("../apps/desktop/src/lib/clear-recent-structures.ts");
await clearNativeRecentStructures(snapshot => snapshots.push(snapshot));
assert.deepEqual(calls, ["clear_recent_documents"]);
assert.deepEqual(snapshots, []);
assert.equal(notices[0].title, "Recent structures could not be cleared");
assert.equal(notices[0].type, "error");
assert.equal(notices[0].timeout, 0);
assert.equal(notices[0].actionProps.children, "Retry");
reject = false;
notices[0].actionProps.onClick();
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(closed, [1]);
assert.deepEqual(calls, ["clear_recent_documents", "clear_recent_documents"]);
assert.deepEqual(snapshots, [saved]);
console.log("clear recent structures retry tests passed");
