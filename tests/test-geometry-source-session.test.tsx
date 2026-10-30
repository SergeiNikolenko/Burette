import { test, expect, mock } from "bun:test";
import { Window } from "happy-dom";
import React, { act } from "react";

const browser = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLIFrameElement", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
}
Object.assign(globalThis, { window: browser, IS_REACT_ACT_ENVIRONMENT: true });
const xyz = "3\nwater\nO 0 0 0\nH 0.9572 0 0\nH -0.24 0.927 0\n";
const changed = xyz.replace("0.9572", "1.7");
const doc = { id: "water", title: "water.xyz", path: "/water.xyz", extension: "xyz", renderer: "molstar", runtimePath: "<html><head></head><body>scene</body></html>" };
let staged = 0;
mock.module("../apps/desktop/src/lib/tauri", () => ({ isTauriRuntime: () => false }));
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureTextDocument: async () => ({ content: xyz, truncated: false }) }));
const browserDocuments = await import("../apps/desktop/src/lib/browser-dev-documents");
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browserDocuments, isBrowserDraftSource: () => false, openBrowserDevTextDocument: async () => { staged++; return { ...doc, runtimePath: "<html>candidate</html>" }; } }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async document => document, useDeferredViewerRuntime: () => ({}) }));
mock.module("../apps/desktop/src/hooks/use-settings", () => ({ useViewerPreferences: () => ({}) }));
mock.module("../apps/desktop/src/lib/web-demo-workspace", () => ({ isWebDemoHeroEmbed: () => false }));
mock.module("../apps/desktop/src/lib/hosted-mcp-widget", () => ({ isHostedMcpWidget: () => false }));
const { createRoot } = await import("react-dom/client");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { ViewerFrame } = await import("../apps/desktop/src/components/editor-area/viewer-frame");

test("opening Geometry and acknowledged drafts preserve the frame; text edits still stage", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let controller;
  const errors = [];
  const options = { activeDocument: doc, preferences: {}, pushErrorStatus: e => errors.push(e), setDockOpen() {}, setDockActiveTab() {} };
  function Fixture() {
    controller = useSourceEditingController(options);
    return <ViewerFrame document={doc} sourcePreview={controller.sessionForDocument(doc)?.sourcePreview} />;
  }
  try {
    await act(async () => root.render(<Fixture />));
    const original = host.querySelector("iframe");
    await act(async () => controller.beginEditing(doc, "geometry"));
    expect(errors).toEqual([]);
    expect(host.querySelector("iframe")).toBe(original);
    const initialRuntime = controller.sessionForDocument(doc).sourcePreview;
    // A queued text update must be cancelled when the scene has accepted Geometry.
    await act(async () => controller.updateDraft(doc, changed));
    await act(async () => controller.updateDraft(doc, changed, { previewApplied: true }));
    await act(async () => new Promise(resolve => setTimeout(resolve, 520)));
    const session = controller.sessionForDocument(doc);
    expect(staged).toBe(0);
    expect(session.sourcePreview).toEqual(initialRuntime);
    expect(session.previewState).toBe("current");
    expect(session.lastValidRevision).toBe(session.revision);
    expect(session.content).toBe(changed);
    expect(session.dirty).toBe(true);
    expect(host.querySelector("iframe")).toBe(original);
    await act(async () => controller.updateDraft(doc, xyz));
    await act(async () => new Promise(resolve => setTimeout(resolve, 520)));
    expect(staged).toBe(1);
    expect(controller.sessionForDocument(doc).previewState).toBe("staging");
    expect(host.querySelectorAll("iframe").length).toBe(2);
    expect(host.querySelector("iframe")).toBe(original);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
