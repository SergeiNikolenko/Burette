#!/usr/bin/env bun
import assert from "node:assert/strict";

import { createDocumentCloseShellActions } from "../apps/desktop/src/hooks/use-app-shell-actions.ts";
import { useMoleculeStore } from "../apps/desktop/src/stores/molecule-store.ts";

const documents = [
  { id: "doc-a", path: "/tmp/a.sdf" },
  { id: "doc-b", path: "/tmp/b.sdf" },
];
const tabs = [
  { id: "tab-a", location: { kind: "file", documentId: "doc-a", path: "/tmp/a.sdf" } },
  { id: "tab-b", location: { kind: "file", documentId: "doc-b", path: "/tmp/b.sdf" } },
  { id: "tab-launcher", location: { kind: "launcher" } },
];

function closeActions(approveClose, options = {}) {
  const calls = [];
  const confirm = (ids) => {
    calls.push(["confirm", ids]);
    if (!approveClose) return null;
    return { release: () => calls.push(["release-permit"]) };
  };
  const actions = createDocumentCloseShellActions({
    activeDocument: options.activeDocument ?? documents[0],
    clearDirtyGridDocuments: () => calls.push(["clear-dirty"]),
    closeActiveDocument: () => calls.push(["close-active"]),
    closeAllDocuments: () => calls.push(["close-all"]),
    closeDocument: (id) => calls.push(["close-document", id]),
    closeGridRuntime: (id) => calls.push(["close-runtime", id]),
    closeTab: (id) => calls.push(["close-tab", id]),
    confirmCloseSourceDocuments: options.confirmSource ?? (() => true),
    confirmDiscardDirtyGridDocument: (id) => confirm(id ? [id] : []),
    confirmDiscardDirtyGridDocuments: confirm,
    documents,
    forgetDirtyGridDocument: (id) => calls.push(["forget-dirty", id]),
    forgetDirtyGridDocuments: (ids) => calls.push(["forget-dirty-many", ids]),
    pushStatus: (message) => calls.push(["status", message]),
    tabs: options.tabs ?? tabs,
  });
  return { actions, calls };
}

{
  const { actions, calls } = closeActions(false);
  await actions.closeOtherTabs("tab-a");
  assert.deepEqual(calls, [["confirm", ["doc-b"]]]);
}

// Closing never waits on in-flight work: once the prompt approves, the tabs go
// away in the same turn and the permit is released.
{
  const { actions, calls } = closeActions(true);
  await actions.closeOtherTabs("tab-a");
  assert.deepEqual(calls, [
    ["confirm", ["doc-b"]],
    ["close-runtime", "doc-b"],
    ["forget-dirty-many", ["doc-b"]],
    ["close-tab", "tab-b"],
    ["close-tab", "tab-launcher"],
    ["status", "Closed other tabs"],
    ["release-permit"],
  ]);
}

// A throwing close still releases the permit, so a later close is never refused.
{
  const calls = [];
  const actions = createDocumentCloseShellActions({
    activeDocument: documents[0],
    clearDirtyGridDocuments: () => {},
    closeActiveDocument: () => {},
    closeAllDocuments: () => {},
    closeDocument: () => {
      throw new Error("close failed");
    },
    closeGridRuntime: () => {},
    closeTab: () => {},
    confirmCloseSourceDocuments: () => true,
    confirmDiscardDirtyGridDocument: () => ({ release: () => calls.push("release-permit") }),
    confirmDiscardDirtyGridDocuments: () => ({ release: () => calls.push("release-permit") }),
    documents,
    forgetDirtyGridDocument: () => {},
    forgetDirtyGridDocuments: () => {},
    pushStatus: () => {},
    tabs,
  });
  await assert.rejects(actions.closeDocument("doc-a"), /close failed/);
  assert.deepEqual(calls, ["release-permit"]);
}

console.log("document close shell action tests passed");

// A bulk close uses one discard permit and never closes unrelated tabs.
{
  const { actions, calls } = closeActions(true);
  await actions.closeTabs(["tab-b", "tab-b", "missing"]);
  assert.deepEqual(calls, [
    ["confirm", ["doc-b"]], ["close-runtime", "doc-b"],
    ["forget-dirty-many", ["doc-b"]], ["close-tab", "tab-b"], ["release-permit"],
  ]);
  const cancelled = closeActions(false);
  await cancelled.actions.closeTabs(["tab-a", "tab-b"]);
  assert.deepEqual(cancelled.calls, [["confirm", ["doc-a", "doc-b"]]]);
}

// Closing B must preserve A when A also occurs in B's navigation history.
const historyTabs = [
  tabs[0],
  { ...tabs[1], back: [tabs[0].location], forward: [] },
];
for (const close of [
  actions => actions.closeDocument("doc-b"),
  actions => actions.closeTab("tab-b"),
  actions => actions.closeTabs(["tab-b"]),
  actions => actions.closeOtherTabs("tab-a"),
  actions => actions.closeActiveDocument(),
]) {
  const sourceIds = [];
  const { actions, calls } = closeActions(true, {
    tabs: historyTabs,
    activeDocument: documents[1],
    confirmSource: async ids => { sourceIds.push(ids); return true; },
  });
  await close(actions);
  assert.deepEqual(sourceIds, [["doc-b"]]);
  assert.deepEqual(calls.filter(call => call[0] === "close-runtime"), [["close-runtime", "doc-b"]]);
}

// A surviving history entry also retains ownership of the closing current file.
{
  const sourceIds = [];
  const { actions, calls } = closeActions(true, {
    tabs: [{ ...tabs[0], forward: [tabs[1].location] }, tabs[1]],
    confirmSource: ids => { sourceIds.push(ids); return true; },
  });
  await actions.closeTabs(["tab-b"]);
  assert.deepEqual(sourceIds, [[]]);
  assert.deepEqual(calls.filter(call => call[0] === "close-runtime"), []);
  assert.ok(calls.some(call => call[0] === "close-tab" && call[1] === "tab-b"));
}

// Grid cancellation must not dispose a source draft before the close commits.
{
  let sourceCalls = 0;
  const { actions, calls } = closeActions(false, {
    confirmSource: () => { sourceCalls += 1; return true; },
  });
  await actions.closeTab("tab-b");
  assert.equal(sourceCalls, 0);
  assert.deepEqual(calls, [["confirm", ["doc-b"]]]);
}

// Native source-release rejection and failure leave tabs/runtimes intact and
// release the Grid permit, so the user's draft remains recoverable.
for (const throws of [false, true]) {
  let release;
  const acknowledgement = new Promise(resolve => { release = resolve; });
  const { actions, calls } = closeActions(true, {
    confirmSource: async () => {
      await acknowledgement;
      if (throws) throw new Error("source close failed");
      return false;
    },
  });
  const closing = actions.closeTab("tab-b");
  for (let step = 0; step < 5; step += 1) await Promise.resolve();
  assert.deepEqual(calls, [["confirm", ["doc-b"]]]);
  release();
  if (throws) await assert.rejects(closing, /source close failed/);
  else await closing;
  assert.deepEqual(calls, [["confirm", ["doc-b"]], ["release-permit"]]);
}

// Switching focus while native release is pending cannot change the tab whose
// dirty state and source handles were approved for this close transaction.
{
  const originalTabs = tabs.slice(0, 2).map(tab => ({ ...tab, back: [], forward: [] }));
  useMoleculeStore.setState({ documents, tabs: originalTabs, activeTabId: "tab-a", activeDocumentId: "doc-a" });
  let release;
  const acknowledgement = new Promise(resolve => { release = resolve; });
  const sourceIds = [];
  const actions = createDocumentCloseShellActions({
    activeDocument: documents[0], documents, tabs: originalTabs,
    closeTab: id => useMoleculeStore.getState().closeTab(id),
    closeActiveDocument: () => { throw new Error("active target must not be re-resolved after acknowledgement"); },
    closeAllDocuments() {}, closeDocument() {}, closeGridRuntime() {},
    clearDirtyGridDocuments() {}, forgetDirtyGridDocument() {}, forgetDirtyGridDocuments() {}, pushStatus() {},
    confirmDiscardDirtyGridDocument: async () => ({ release() {} }),
    confirmDiscardDirtyGridDocuments: async () => ({ release() {} }),
    confirmCloseSourceDocuments: async ids => { sourceIds.push(ids); await acknowledgement; return true; },
  });
  const closing = actions.closeActiveDocument();
  for (let step = 0; step < 5; step++) await Promise.resolve();
  useMoleculeStore.getState().setActiveTab("tab-b");
  release();
  await closing;
  assert.deepEqual(sourceIds, [["doc-a"]]);
  assert.deepEqual(useMoleculeStore.getState().tabs.map(tab => tab.id), ["tab-b"]);
  assert.equal(useMoleculeStore.getState().activeDocumentId, "doc-b");
}
