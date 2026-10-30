import { afterAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ViewerDocument, ViewerPreferences } from "../apps/desktop/src/types";

plugin({ name: "geometry-frame-owner-compiler", setup(build) {
  build.onLoad({ filter: /(?:hooks\/use-source-editing\.ts|editor-area\/viewer-frame\.tsx)$/u }, ({ path }) => ({
    contents: transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: path.endsWith("tsx") ? ["typescript", "jsx"] : ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })!.code!, loader: path.endsWith("tsx") ? "tsx" : "ts",
  }));
} });
const browser = new Window({ url: "http://localhost/" }), previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, CSS: browser.CSS,
  HTMLElement: browser.HTMLElement, HTMLIFrameElement: browser.HTMLIFrameElement, Element: browser.Element, Node: browser.Node,
  Event: browser.Event, MessageEvent: browser.MessageEvent, CustomEvent: browser.CustomEvent, MutationObserver: browser.MutationObserver,
  localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterAll(async () => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } await browser.happyDOM.close(); });
const xyz = "3\nwater\nO 0 0 0\nH 0.9572 0 0\nH -0.24 0.927 0\n", changed = xyz.replace("0.9572", "1.7");
let waitForRead: Promise<void> | null = null, waitForBuild: Promise<void> | null = null, built = 0;
const tauri = await import("../apps/desktop/src/lib/tauri");
mock.module("../apps/desktop/src/lib/tauri", () => ({ ...tauri, isTauriRuntime: () => false }));
mock.module("../apps/desktop/src/lib/structure-text", () => ({ readStructureTextDocument: async () => { await waitForRead; return { content: xyz, truncated: false }; } }));
const browserDocuments = await import("../apps/desktop/src/lib/browser-dev-documents");
mock.module("../apps/desktop/src/lib/browser-dev-documents", () => ({ ...browserDocuments, openBrowserDevTextDocument: async () => {
  const serial = ++built; await waitForBuild; return { runtimePath: `<html>candidate ${serial}</html>` };
} }));
mock.module("../apps/desktop/src/hooks/use-deferred-viewer-runtime", () => ({ prepareDeferredViewerRuntime: async (document: ViewerDocument) => document, useDeferredViewerRuntime: () => ({}) }));
mock.module("../apps/desktop/src/hooks/use-settings", () => ({ useViewerPreferences: () => ({}) }));
mock.module("../apps/desktop/src/lib/web-demo-workspace", () => ({ isWebDemoHeroEmbed: () => false }));
mock.module("../apps/desktop/src/lib/hosted-mcp-widget", () => ({ isHostedMcpWidget: () => false }));
const { createRoot } = await import("react-dom/client");
const { ViewerFrame } = await import("../apps/desktop/src/components/editor-area/viewer-frame");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { requestViewerAction } = await import("../apps/desktop/src/lib/viewer-bridge");
let serial = 0;
const doc = (): ViewerDocument => ({ id: `geometry-owner-${++serial}`, path: `/water-${serial}.xyz`, title: "water.xyz", extension: "xyz", renderer: "molstar", runtimePath: "<html><head></head><body>scene</body></html>", byteCount: xyz.length });
async function fixture() {
  const initial = doc(), errors: unknown[] = [], host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let controller!: ReturnType<typeof useSourceEditingController>;
  function Probe({ document }: { document: ViewerDocument }) {
    controller = useSourceEditingController({ activeDocument: document, preferences: {} as ViewerPreferences, pushErrorStatus: error => errors.push(error), setDockOpen() {}, setDockActiveTab() {} });
    return <ViewerFrame document={document} sourcePreview={controller.sessionForDocument(document)?.sourcePreview ?? undefined} onStagingLoad={(identity, frame) => controller.stagingLoaded(document, identity, frame)} />;
  }
  const render = (value = initial) => act(async () => root.render(<Probe document={value} />)); await render();
  return { doc: initial, errors, host, get controller() { return controller; }, render, frame: () => host.querySelector<HTMLIFrameElement>("iframe.viewer-iframe")!,
    close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
function listen(frame: HTMLIFrameElement) {
  const requests: { body: { id: string } }[] = [], source = frame.contentWindow!;
  source.postMessage = (data: unknown) => { const message = data as { body?: { id?: unknown } }; if (typeof message.body?.id === "string") requests.push(data as { body: { id: string } }); };
  return { requests, source, reply: (id: string, from: WindowProxy = source) => window.dispatchEvent(new MessageEvent("message", { source: from, data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id, result: { ok: true, result: { captured: true } } } } })) };
}

// Geometry is not yet a DockTabKind in HEAD; the unchanged original test exercises that pending tab.
// Typed regressions exercise the same shared source-session path through its admitted default tab.
test("opening the compiled source session retains the actual frame/window and its pending capture", async () => {
  const f = await fixture();
  try {
    const original = f.frame(), transport = listen(original), pending = requestViewerAction(f.doc.id, { type: "capture" }, 1000).catch(error => error);
    await act(async () => f.controller.beginEditing(f.doc));
    expect(f.frame()).toBe(original); expect(f.frame().contentWindow).toBe(transport.source);
    expect(f.controller.ownsCurrentSourceFrame(f.doc, original)).toBe(true); expect(original.dataset.sourcePreviewRole).toBe("active");
    transport.reply(transport.requests[0].body.id); expect(await pending).toEqual({ captured: true }); expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test("title changes retain the frame; changed runtime or document id rotates the frame and rejects old capture", async () => {
  const f = await fixture();
  try {
    const original = f.frame(); await f.render({ ...f.doc, title: "renamed.xyz" }); expect(f.frame()).toBe(original);
    const transport = listen(original), pending = requestViewerAction(f.doc.id, { type: "capture" }, 1000).catch(error => (error as Error).message);
    await f.render({ ...f.doc, runtimePath: "<html>replacement</html>" }); expect(f.frame()).not.toBe(original);
    transport.reply(transport.requests[0].body.id); expect(await pending).toContain("viewer changed");
    const replacement = f.frame(); await f.render({ ...doc(), runtimePath: "<html>replacement</html>" }); expect(f.frame()).not.toBe(replacement);
  } finally { await f.close(); }
});

test("cancellation and foreign/late replies cannot settle the later request on a retained Geometry frame", async () => {
  const f = await fixture();
  try {
    const transport = listen(f.frame()), abort = new AbortController(), old = requestViewerAction(f.doc.id, { type: "capture" }, 1000, abort.signal).catch(error => (error as Error).message);
    abort.abort(); expect(await old).toContain("cancelled"); await act(async () => f.controller.beginEditing(f.doc));
    let settled = false; const next = requestViewerAction(f.doc.id, { type: "capture" }, 1000).then(value => { settled = true; return value; }).catch(error => error);
    transport.reply(transport.requests[0].body.id); transport.reply(transport.requests[1].body.id, window); await Promise.resolve(); expect(settled).toBe(false);
    transport.reply(transport.requests[1].body.id); expect(await next).toEqual({ captured: true });
  } finally { await f.close(); }
});

test("a superseded text build and a late removed staging-frame ready cannot replace the retained scene", async () => {
  const f = await fixture(); let release!: () => void;
  try {
    await act(async () => f.controller.beginEditing(f.doc)); const original = f.frame();
    await act(async () => f.controller.updateDraft(f.doc, changed)); waitForBuild = new Promise(resolve => { release = resolve; }); let pending!: Promise<void>;
    await act(async () => { pending = Promise.resolve(f.controller.applyPreview(f.doc)); });
    await act(async () => f.controller.updateDraft(f.doc, changed.replace("1.7", "1.8")));
    await act(async () => { release(); await pending; }); waitForBuild = null;
    expect(f.host.querySelectorAll("iframe")).toHaveLength(1); expect(f.frame()).toBe(original); expect(f.controller.sessionForDocument(f.doc)?.previewState).toBe("queued");
    await act(async () => f.controller.applyPreview(f.doc)); const staging = f.host.querySelector<HTMLIFrameElement>("iframe.source-preview-staging-iframe")!, oldWindow = staging.contentWindow!;
    await act(async () => staging.dispatchEvent(new Event("load"))); expect(staging.getAttribute("aria-hidden")).toBe("true");
    await act(async () => f.controller.updateDraft(f.doc, xyz));
    await act(async () => window.dispatchEvent(new MessageEvent("message", { source: oldWindow, data: { source: "burette-viewer", body: { type: "ready", renderer: "molstar", molstarStructureCount: 1 } } })));
    expect(f.frame()).toBe(original); expect(f.host.querySelectorAll("iframe")).toHaveLength(1); expect(f.controller.sessionForDocument(f.doc)?.previewState).toBe("queued");
  } finally { waitForBuild = null; release?.(); await f.close(); }
});

test("close while source read is pending expires its operation; another document keeps its own frame", async () => {
  const f = await fixture(); let release!: () => void;
  try {
    const operation = f.controller.captureOperation(f.doc); waitForRead = new Promise(resolve => { release = resolve; }); let opening!: Promise<void>;
    await act(async () => { opening = Promise.resolve(f.controller.beginEditing(f.doc)); });
    const other = doc(); await f.render(other); const otherFrame = f.frame(), otherOperation = f.controller.captureOperation(other);
    await act(async () => { expect(await f.controller.closeDocuments([f.doc.id])).toBe(true); release(); await opening; });
    expect(operation.isCurrent()).toBe(false); expect(otherOperation.isCurrent()).toBe(true); expect(f.controller.sessionForDocument(f.doc)).toBeNull(); expect(f.frame()).toBe(otherFrame);
    operation.release(); otherOperation.release(); expect(f.errors).toEqual([]);
  } finally { waitForRead = null; release?.(); await f.close(); }
});
