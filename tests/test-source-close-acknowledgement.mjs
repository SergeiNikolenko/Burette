#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mock } from "bun:test";

let sessions;
const calls = [];
let close = async () => {};
let confirm = async () => true;
let message = async () => {};
let saveSource = async () => ({ revision: {} });
const dialogs = [];
let openSource = async () => ({
  handleId: "handle", content: "ATOM original\n", previewMode: "live",
  revision: { modifiedAt: 0, byteCount: 14, contentHash: "original" },
});
const errors = [];
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { location: { search: "" }, confirm() { throw new Error("Native source close used window.confirm"); }, alert() { throw new Error("Native source close used window.alert"); }, setTimeout: () => 1, clearTimeout() {} };
const react = await import("react");
mock.module("react", () => ({
  ...react,
  useCallback: callback => callback, useMemo: callback => callback(), useEffect() {},
  useRef: current => ({ current }), useState: initial => [initial, value => { sessions = value; }],
}));
const core = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...core, invoke: async (command, args) => {
  calls.push([command, args]);
  if (command === "open_source_edit_session") return openSource();
  if (command === "close_opened_source_documents") return close();
  if (command === "save_source_document") return saveSource();
} }));
mock.module("@tauri-apps/plugin-dialog", () => ({
  confirm: async (text, options) => { dialogs.push(["confirm", text, options]); return confirm(); },
  message: async (text, options) => { dialogs.push(["message", text, options]); return message(); },
}));
mock.module("../apps/desktop/src/components/workspace-panes/native-scene-window", () => ({
  nativePopoutBusy: () => false, isNativePopoutTab: () => false, returnNativePopout: async () => false,
}));
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => true, trackTauriListener: () => () => {} }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async document => document, useDeferredViewerRuntime: document => document }));

const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing.ts");
const { createDocumentCloseShellActions } = await import("../apps/desktop/src/hooks/use-app-shell-actions.ts");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store.ts");
const document = { id: "doc", path: "/tmp/source.pdb", title: "source.pdb", extension: "pdb", renderer: "molstar", runtimePath: "/tmp/preview.html" };
const controller = useSourceEditingController({ activeDocument: document, preferences: {},
  pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {},
});
await controller.beginEditing(document);
controller.updateDraft(document, "ATOM draft\n");
const draft = sessions[document.path];

function shellActions() {
  useMoleculeStore.getState().setDocuments([document]);
  const state = useMoleculeStore.getState();
  return createDocumentCloseShellActions({
    activeDocument: document, documents: state.documents, tabs: state.tabs,
    closeTab: state.closeTab, closeTabsInStore: state.closeTabs, closeDocument: state.closeDocument,
    closeActiveDocument: state.closeActiveDocument, closeAllDocuments: state.closeAllDocuments,
    closeGridRuntime() {}, clearDirtyGridDocuments() {}, forgetDirtyGridDocument() {}, forgetDirtyGridDocuments() {},
    confirmCloseSourceDocuments: controller.closeDocuments,
    confirmDiscardDirtyGridDocument: async () => ({ release() {} }),
    confirmDiscardDirtyGridDocuments: async () => ({ release() {} }), pushStatus() {},
  });
}

// Exercise the shell routes with the real source owner and document store, not
// a stubbed dirty flag. Cancelling either route retains tab, draft and handle.
confirm = async () => false;
for (const route of ["closeTab", "clearAllDocuments"]) {
  const actions = shellActions();
  const tabs = useMoleculeStore.getState().tabs;
  await actions[route](tabs[0].id);
  assert.deepEqual(useMoleculeStore.getState().tabs, tabs);
  assert.equal(sessions[document.path], draft);
}
assert.equal(calls.filter(([command]) => command === "close_opened_source_documents").length, 0);
assert.deepEqual(dialogs.at(-1)[2], { title: "Unsaved Source Changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" });

let answer;
confirm = () => new Promise(resolve => { answer = resolve; });
const prompting = controller.closeDocuments([document.id]);
controller.updateDraft(document, "must not replace draft during confirmation");
await controller.save(document);
assert.equal(await controller.closeDocuments([document.id]), false, "overlapping closes cannot bypass the pending prompt");
assert.equal(sessions[document.path], draft);
assert.equal(controller.getWindowDirtySnapshot().closeTransitionActive, true);
answer(false);
assert.equal(await prompting, false);
assert.equal(controller.getWindowDirtySnapshot().closeTransitionActive, false);
confirm = async () => { throw new Error("dialog unavailable"); };
assert.equal(await controller.closeDocuments([document.id]), false);
assert.equal(sessions[document.path], draft, "a failed native dialog cannot authorize discarding the draft");
assert.equal(controller.getWindowDirtySnapshot().closeTransitionActive, false);
errors.length = 0;
confirm = async () => true;
close = async () => { throw new Error("source_commit_uncertain"); };
assert.equal(await controller.closeDocuments([document.id]), false);
assert.equal(sessions[document.path], draft, "a rejected native release preserves the full editable draft");
assert.equal(errors.length, 1);

let release;
let closeStarted;
const closing = new Promise(resolve => { closeStarted = resolve; });
close = () => { closeStarted(); return new Promise(resolve => { release = resolve; }); };
const pending = controller.closeDocuments([document.id]);
controller.updateDraft(document, "must not replace draft during close");
await controller.save(document);
assert.equal(sessions[document.path], draft);
assert.equal(controller.getWindowDirtySnapshot().closeTransitionActive, true);
await closing;
release();
assert.equal(await pending, true);
assert.deepEqual(sessions, {});
assert.equal(controller.getWindowDirtySnapshot().closeTransitionActive, false);
assert.equal(calls.filter(([command]) => command === "close_source_edit_session").length, 0,
  "batch close owns native edit handles without additional IPC per edit");

close = async () => {};
for (const route of ["closeTab", "clearAllDocuments"]) {
  await controller.beginEditing(document);
  controller.updateDraft(document, "ATOM draft\n");
  const actions = shellActions();
  await actions[route](useMoleculeStore.getState().tabs[0].id);
  assert.equal(useMoleculeStore.getState().documents.length, 0);
  assert.deepEqual(sessions, {}, "explicit Discard releases the source draft only after acknowledgement");
}

await controller.beginEditing(document);
controller.updateDraft(document, "ATOM pending save\n");
let rejectSave;
saveSource = () => new Promise((resolve, reject) => { rejectSave = reject; });
const saving = controller.save(document);
await Promise.resolve();
const releaseCount = calls.filter(([command]) => command === "close_opened_source_documents").length;
await shellActions().clearAllDocuments();
assert.equal(dialogs.at(-1)[0], "message");
assert.equal(dialogs.at(-1)[2].title, "Save in Progress");
assert.equal(useMoleculeStore.getState().documents.length, 1);
assert.equal(sessions[document.path].content, "ATOM pending save\n");
const pendingDraft = sessions[document.path];
const dialogError = new Error("message unavailable");
message = async () => { throw dialogError; };
assert.equal(await controller.closeDocuments([document.id]), false);
assert.equal(errors.at(-1), dialogError);
await shellActions().clearAllDocuments();
assert.equal(useMoleculeStore.getState().documents.length, 1);
assert.equal(sessions[document.path], pendingDraft, "a rejected Save in Progress dialog preserves the pending draft and handle");
assert.equal(calls.filter(([command]) => command === "close_opened_source_documents").length, releaseCount);
message = async () => {};
rejectSave(new Error("disk full"));
await saving;
assert.equal(sessions[document.path].dirty, true);
assert.equal(sessions[document.path].saving, false);
assert.equal(sessions[document.path].diagnostic, "disk full");
confirm = async () => false;
await shellActions().clearAllDocuments();
assert.equal(calls.filter(([command]) => command === "close_opened_source_documents").length, releaseCount);
assert.equal(sessions[document.path].content, "ATOM pending save\n", "a rejected save never authorizes discarding its draft");
confirm = async () => true;
await shellActions().clearAllDocuments();
assert.deepEqual(sessions, {});

calls.length = 0;
close = async () => {};
assert.equal(await controller.closeDocuments(Array.from({ length: 1000 }, (_, i) => `pdb-${i}`)), true);
assert.equal(calls.length, 1, "1000 source documents unregister in one native call");

// A native source open that completes after close cannot resurrect its edit
// session, even after the close acknowledgement has cleared the closing flag.
let completeOpen;
openSource = () => new Promise(resolve => { completeOpen = resolve; });
const opening = controller.beginEditing(document);
await Promise.resolve();
assert.equal(typeof completeOpen, "function");
assert.equal(await controller.closeDocuments([document.id]), true);
completeOpen({ handleId: "late-handle", content: "ATOM late\n", previewMode: "live", revision: {} });
await opening;
assert.deepEqual(sessions, {});
assert.deepEqual(calls.at(-1), ["close_source_edit_session", { request: { handleId: "late-handle" } }]);
console.log("source close acknowledgement tests passed");
