import { expect, mock, spyOn, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import { Window } from "happy-dom";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ViewerDocument, ViewerPreferences } from "../apps/desktop/src/types";

plugin({ name: "source-prerequisite-compiler", setup(build) {
  build.onLoad({ filter: /hooks\/use-source-editing\.ts$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: "ts",
  }));
} });
const browser = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "MessageEvent", "CustomEvent", "MutationObserver", "localStorage", "CSS"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
}
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true });
const source = "ATOM      1  C   MOL A   1       0.000   0.000   0.000\n";
let waitForRead: Promise<void> | null = null;
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false, trackTauriListener: () => () => {} }));
mock.module("../apps/desktop/src/lib/structure-text", () => ({
  readStructureTextDocument: async () => { await waitForRead; return { content: source, truncated: false }; },
}));
const browserDocuments = await import("../apps/desktop/src/lib/browser-dev-documents");
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browserDocuments, openBrowserDevTextDocument: async () => { throw new Error("Unexpected preview in a lifetime test."); } }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async document => document, useDeferredViewerRuntime: document => document }));
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { requestViewerAction } = await import("../apps/desktop/src/lib/viewer-bridge");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
let serial = 0;
async function fixture() {
  const doc = { id: `prerequisite-${++serial}`, path: `/prerequisite-${serial}.pdb`, title: "source.pdb", extension: "pdb", renderer: "molstar", runtimePath: "<html/>" } as ViewerDocument;
  let controller!: ReturnType<typeof useSourceEditingController>, setShown!: (shown: boolean) => void, setCurrent!: (doc: ViewerDocument) => void;
  const errors: unknown[] = [], host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  function Fixture() {
    const [shown, show] = useState(true); setShown = show;
    const [current, select] = useState(doc); setCurrent = select;
    controller = useSourceEditingController({ activeDocument: shown ? current : null, preferences: {} as ViewerPreferences,
      pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} });
    return null;
  }
  await act(async () => root.render(<Fixture />));
  return { doc, errors, get controller() { return controller; },
    hide: async () => { await act(async () => setShown(false)); },
    replace: async (replacement: ViewerDocument) => { await act(async () => setCurrent(replacement)); },
    close: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}
test("compiled source accessor sees an awaited session and same-turn draft updates", async () => {
  const view = await fixture();
  try {
    const retained = view.controller;
    await act(async () => retained.beginEditing(view.doc));
    expect(retained.sessionForDocument(view.doc)?.content).toBe(source);
    await act(async () => retained.updateDraft(view.doc, source + "REMARK draft\n"));
    expect(retained.sessionForDocument(view.doc)?.content).toBe(source + "REMARK draft\n");
    expect(retained.sessionForDocument(view.doc)?.previewState).toBe("queued");
    expect(view.errors).toEqual([]);
  } finally { await view.close(); }
});
test("independent operations survive hiding and release, but expire on close without a session", async () => {
  const view = await fixture();
  try {
    const first = view.controller.captureOperation(view.doc), second = view.controller.captureOperation(view.doc);
    first.release(); expect(first.isCurrent()).toBe(false); expect(second.isCurrent()).toBe(true);
    await view.hide(); expect(second.isCurrent()).toBe(true);
    await act(async () => { expect(await view.controller.closeDocuments(["another-document"])).toBe(true); });
    expect(second.isCurrent()).toBe(true);
    await act(async () => { expect(await view.controller.closeDocuments([view.doc.id])).toBe(true); });
    expect(second.isCurrent()).toBe(false);
    const fresh = view.controller.captureOperation(view.doc); expect(fresh.isCurrent()).toBe(true);
    await view.close(); expect(fresh.isCurrent()).toBe(false); fresh.release();
  } catch (error) { await view.close(); throw error; }
});
test("Cancel preserves a dirty operation, successful close permanently expires it", async () => {
  const view = await fixture(), previous = browser.confirm;
  try {
    await act(async () => view.controller.beginEditing(view.doc));
    await act(async () => view.controller.updateDraft(view.doc, source + "REMARK unsaved\n"));
    const operation = view.controller.captureOperation(view.doc);
    browser.confirm = () => false;
    await act(async () => { expect(await view.controller.closeDocuments([view.doc.id])).toBe(false); });
    expect(operation.isCurrent()).toBe(true);
    expect(view.controller.sessionForDocument(view.doc)?.dirty).toBe(true);
    browser.confirm = () => true;
    await act(async () => { expect(await view.controller.closeDocuments([view.doc.id])).toBe(true); });
    expect(operation.isCurrent()).toBe(false); expect(view.controller.sessionForDocument(view.doc)).toBeNull();
    operation.release();
  } finally { browser.confirm = previous; await view.close(); }
});
test("close during source read cannot resurrect a session or its old document operation", async () => {
  const view = await fixture(); let release!: () => void;
  waitForRead = new Promise(resolve => { release = resolve; });
  try {
    const operation = view.controller.captureOperation(view.doc); let opening!: Promise<void>;
    await act(async () => { opening = view.controller.beginEditing(view.doc); });
    await act(async () => { expect(await view.controller.closeDocuments([view.doc.id])).toBe(true); });
    await act(async () => { release(); await opening; });
    expect(view.controller.sessionForDocument(view.doc)).toBeNull(); expect(operation.isCurrent()).toBe(false);
    expect(view.errors).toEqual([]); operation.release();
  } finally { waitForRead = null; release(); await view.close(); }
});
function frame() {
  const value = document.createElement("iframe"), requests: any[] = [];
  value.className = "viewer-iframe"; value.dataset.documentId = "transport";
  document.body.append(value); const source = value.contentWindow!;
  source.postMessage = body => { requests.push(body); };
  return { value, source, requests };
}
function reply(source: unknown, id: string, result = { ok: true, result: { retained: true } }) {
  window.dispatchEvent(new MessageEvent("message", { source: source as Window, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id, result } } }));
}
test("aborting actual viewer requests removes listeners and a pre-aborted request sends nothing", async () => {
  const f = frame(), listeners = new Set<unknown>();
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  const adding = spyOn(window, "addEventListener").mockImplementation((type, handler, ...rest) => { if (type === "message") listeners.add(handler); add(type, handler, ...rest); });
  const removing = spyOn(window, "removeEventListener").mockImplementation((type, handler, ...rest) => { if (type === "message") listeners.delete(handler); remove(type, handler, ...rest); });
  try {
    const controller = new AbortController(), pending = requestViewerAction("transport", { type: "read" }, 1000, controller.signal);
    const settled = pending.catch(error => error);
    expect(listeners.size).toBe(1); controller.abort(); expect((await settled).message).toContain("cancelled"); expect(listeners.size).toBe(0);
    await expect(requestViewerAction("transport", { type: "read" }, 1000, controller.signal)).rejects.toThrow();
    expect(f.requests).toHaveLength(1); expect(listeners.size).toBe(0);
  } finally { adding.mockRestore(); removing.mockRestore(); f.value.remove(); }
});
test("a late reply from a replaced iframe cannot authorize the new document view", async () => {
  const f = frame(); let replacement: ReturnType<typeof frame> | null = null;
  try {
    const pending = requestViewerAction("transport", { type: "read" }, 1000), settled = pending.catch(error => error);
    const id = f.requests[0].body.id; f.value.remove(); replacement = frame(); reply(f.source, id); expect((await settled).message).toContain("viewer changed");
    expect(replacement.requests).toEqual([]);
  } finally { f.value.remove(); replacement?.value.remove(); }
});
test("foreign/stale replies are ignored; matching replies and timeout settle actual transport", async () => {
  const f = frame();
  try {
    const pending = requestViewerAction("transport", { type: "read" }, 1000), id = f.requests[0].body.id;
    reply({}, id); reply(f.source, "old-request"); reply(f.source, id);
    expect(await pending).toEqual({ retained: true });
    await expect(requestViewerAction("transport", { type: "read" }, 5)).rejects.toThrow("did not respond");
    f.value.dataset.readOnly = "true";
    await expect(requestViewerAction("transport", { type: "read" })).rejects.toThrow("wait for it to load");
  } finally { f.value.remove(); }
});

test("a same-path replacement in the actual document store cannot inherit another document's dirty session", async () => {
  const view = await fixture();
  try {
    await act(async () => view.controller.beginEditing(view.doc));
    await act(async () => view.controller.updateDraft(view.doc, source + "REMARK retained old draft\n"));
    const originalSession = view.controller.sessionForDocument(view.doc);
    useMoleculeStore.getState().setDocuments([view.doc]);
    const replacement = { ...view.doc, id: view.doc.id + "-replacement", runtimePath: "<html>replacement</html>" };
    useMoleculeStore.getState().openDocumentsInActiveTab([replacement]);
    const actual = useMoleculeStore.getState().documents.find(document => document.path === view.doc.path)!;
    expect(actual.id).toBe(replacement.id); await view.replace(actual);
    expect(view.controller.sessionForDocument(actual)).toBeNull();
    expect(view.controller.sessionForDocument(view.doc)).toBe(originalSession);
    expect(originalSession?.dirty).toBe(true);
    expect(originalSession?.content).toBe(source + "REMARK retained old draft\n");
  } finally { await view.close(); }
});
