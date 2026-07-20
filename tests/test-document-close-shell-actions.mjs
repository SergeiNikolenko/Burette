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

function closeActions(approveClose, waitForPending) {
  const calls = [];
  globalThis.document = {
    querySelectorAll: () => [{
      dataset: { documentId: "doc-b" },
      inert: false,
      blur: () => calls.push(["blur-grid", "doc-b"]),
      toggleAttribute: () => {},
      contentWindow: {
        postMessage: (message) => calls.push([
          "grid-close-transition",
          message.body.active,
        ]),
      },
    }],
  };
  const confirm = (ids) => {
    calls.push(["confirm", ids]);
    if (!approveClose) return null;
    return {
      waitForPending: async (pendingIds) => {
        calls.push(["wait-pending", [...pendingIds]]);
        await waitForPending?.();
      },
      release: () => calls.push(["release-permit"]),
    };
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

{
  let finishPending;
  const pending = new Promise((resolve) => {
    finishPending = resolve;
  });
  const { actions, calls } = closeActions(true, () => pending);
  const closing = actions.closeOtherTabs("tab-a");
  await Promise.resolve();
  assert.deepEqual(calls, [
    ["confirm", ["doc-b"]],
    ["blur-grid", "doc-b"],
    ["grid-close-transition", true],
    ["wait-pending", ["doc-b"]],
  ]);
  finishPending();
  await closing;
  assert.deepEqual(calls, [
    ["confirm", ["doc-b"]],
    ["blur-grid", "doc-b"],
    ["grid-close-transition", true],
    ["wait-pending", ["doc-b"]],
    ["close-runtime", "doc-b"],
    ["forget-dirty-many", ["doc-b"]],
    ["close-tab", "tab-b"],
    ["close-tab", "tab-launcher"],
    ["status", "Closed other tabs"],
    ["grid-close-transition", false],
    ["release-permit"],
  ]);
}

delete globalThis.document;

console.log("document close shell action tests passed");
