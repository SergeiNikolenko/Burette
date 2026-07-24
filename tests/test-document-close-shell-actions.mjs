#!/usr/bin/env bun
import assert from "node:assert/strict";

import { createDocumentCloseShellActions } from "../apps/desktop/src/hooks/use-app-shell-actions.ts";

const documents = [
  { id: "doc-a", path: "/tmp/a.sdf" },
  { id: "doc-b", path: "/tmp/b.sdf" },
];
const tabs = [
  { id: "tab-a", location: { kind: "file", documentId: "doc-a", path: "/tmp/a.sdf" } },
  { id: "tab-b", location: { kind: "file", documentId: "doc-b", path: "/tmp/b.sdf" } },
  { id: "tab-launcher", location: { kind: "launcher" } },
];

function closeActions(approveClose) {
  const calls = [];
  const confirm = (ids) => {
    calls.push(["confirm", ids]);
    if (!approveClose) return null;
    return { release: () => calls.push(["release-permit"]) };
  };
  const actions = createDocumentCloseShellActions({
    activeDocument: documents[0],
    clearDirtyGridDocuments: () => calls.push(["clear-dirty"]),
    closeActiveDocument: () => calls.push(["close-active"]),
    closeAllDocuments: () => calls.push(["close-all"]),
    closeDocument: (id) => calls.push(["close-document", id]),
    closeGridRuntime: (id) => calls.push(["close-runtime", id]),
    closeTab: (id) => calls.push(["close-tab", id]),
    confirmCloseSourceDocuments: () => true,
    confirmDiscardDirtyGridDocument: (id) => confirm(id ? [id] : []),
    confirmDiscardDirtyGridDocuments: confirm,
    documents,
    forgetDirtyGridDocument: (id) => calls.push(["forget-dirty", id]),
    forgetDirtyGridDocuments: (ids) => calls.push(["forget-dirty-many", ids]),
    pushStatus: (message) => calls.push(["status", message]),
    tabs,
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
