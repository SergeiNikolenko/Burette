import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window as HappyWindow } from "happy-dom";
import React, { act } from "react";
import { test, mock } from "bun:test";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
import type { ViewerDocument } from "../apps/desktop/src/types";
import type { ShellActions } from "../apps/desktop/src/components/types";
plugin({
  name: "source-selection-compiled-ownership",
  setup(build) {
    build.onLoad(
      {
        filter:
          /(?:hooks\/(?:use-source-editing|use-app-viewer-state-messages)|lib\/workbench\/use-graph-draft|components\/workbench\/structure-edit-panel)\.tsx?$/u,
      },
      ({ path }) => ({
        contents: transformSync(readFileSync(path, "utf8"), {
          filename: path,
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ["typescript", "jsx"] },
          plugins: [["babel-plugin-react-compiler", {}]],
        })!.code!,
        loader: path.endsWith(".tsx") ? "tsx" : "ts",
      }),
    );
  },
});
const browser = new HappyWindow({ url: "http://localhost/" });

for (const [name, value] of Object.entries({
  window: browser,
  self: browser,
  document: browser.document,
  Node: browser.Node,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLFormElement: browser.HTMLFormElement,
  HTMLButtonElement: browser.HTMLButtonElement,
  DocumentFragment: browser.DocumentFragment,
  MutationObserver: browser.MutationObserver,
  NodeFilter: browser.NodeFilter,
  HTMLDivElement: browser.HTMLDivElement,
  SVGElement: browser.SVGElement,
  CustomEvent: browser.CustomEvent,
  DOMRect: browser.DOMRect,
  Event: browser.Event,
  FocusEvent: browser.FocusEvent,
  KeyboardEvent: browser.KeyboardEvent,
  MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent,
  navigator: browser.navigator,
  localStorage: browser.localStorage,
  requestAnimationFrame: (callback: () => void) => browser.setTimeout(callback, 0),
  cancelAnimationFrame: (id: ReturnType<typeof browser.setTimeout>) => browser.clearTimeout(id),
  getComputedStyle: browser.getComputedStyle.bind(browser),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
browser.HTMLElement.prototype.setPointerCapture = () => {};
browser.HTMLElement.prototype.releasePointerCapture = () => {};
browser.HTMLElement.prototype.hasPointerCapture = () => true;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

Object.defineProperty(globalThis, "MessageEvent", {
  configurable: true,
  value: browser.MessageEvent,
});
Object.defineProperty(globalThis, "CSS", { configurable: true, value: browser.CSS });
Object.defineProperty(globalThis, "HTMLIFrameElement", {
  configurable: true,
  value: browser.HTMLIFrameElement,
});
const source = readFileSync(
  new URL("../samples/collections/sdf/single.sdf", import.meta.url),
  "utf8",
);
mock.module("../apps/desktop/src/lib/structure-text", () => ({
  readStructureText: async () => source,
  readStructureTextDocument: async () => ({ content: source, truncated: false }),
}));
const { createRoot } = await import("react-dom/client");
const { SourceEditingProvider } = await import("../apps/desktop/src/lib/source-editing/context");
const { useSourceEditingController } = await import("../apps/desktop/src/hooks/use-source-editing");
const { StructureEditPanel } =
  await import("../apps/desktop/src/components/workbench/structure-edit-panel");
const { useAppViewerStateMessages } =
  await import("../apps/desktop/src/hooks/use-app-viewer-state-messages");
const { ViewerFrame } = await import("../apps/desktop/src/components/editor-area/viewer-frame");
const { useGraphDraft } = await import("../apps/desktop/src/lib/workbench/use-graph-draft");
const { defaultPreferences } = await import("../apps/desktop/src/stores/settings-store");
const target: ViewerDocument = {
  id: "source-selection-owner",
  title: "ethanol.sdf",
  path: "/source-selection-owner.sdf",
  extension: "sdf",
  renderer: "molstar",
  runtimePath: "old source scene",
  byteCount: source.length,
};
const noop = () => {};
let graph!: ReturnType<typeof useGraphDraft>;
let controller!: ReturnType<typeof useSourceEditingController>,
  handle!: ReturnType<typeof useAppViewerStateMessages>["handleViewerStateMessage"];
const actions = { runStructureViewerAction: async () => {} } as unknown as ShellActions;
function Editor() {
  graph = useGraphDraft(target);
  return <StructureEditPanel document={target} actions={actions} />;
}
function Workspace() {
  controller = useSourceEditingController({
    activeDocument: target,
    preferences: defaultPreferences,
    pushErrorStatus: (error) => {
      throw error;
    },
    setDockOpen: noop,
    setDockActiveTab: noop,
  });
  ({ handleViewerStateMessage: handle } = useAppViewerStateMessages({
    ownsCurrentSourceFrame: controller.ownsCurrentSourceFrame,
    activeDocument: target,
    documents: [target],
    updateDirtyGridDocument: noop,
    addDocuments: noop,
    openCommandPalette: noop,
    openDockTab: noop,
    toggleDockTab: noop,
    setPreference: noop,
    setViewerLigandSelections: noop,
    setStructureOverlayModes: noop,
    setStructureStories: noop,
    toggleSidebar: noop,
    toggleDock: noop,
  }));
  return (
    <SourceEditingProvider value={controller}>
      <ViewerFrame
        document={target}
        sourcePreview={controller.sessionForDocument(target)?.sourcePreview ?? undefined}
        onStagingLoad={(identity, frame) => controller.stagingLoaded(target, identity, frame)}
      />
      <Editor />
    </SourceEditingProvider>
  );
}
async function until(host: Element, condition: () => unknown, label: string) {
  for (let n = 0; n < 200; n++) {
    if (condition()) return;
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
  assert.fail(label + " " + host.textContent);
}
const click = (e: Element) =>
  act(async () => {
    e.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
test("real queued source, promotion and in-place ACK own the atom selection of their exact runtime", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const pick = async (source: Window, index: number) =>
    act(async () =>
      handle(
        "burette-viewer",
        {
          type: "selectionChanged",
          documentId: target.id,
          selection: { atoms: 1, atomIdentities: [{ sourceIndex: index, atomIndex: index }] },
        },
        source,
      ),
    );
  const activeFrame = () => host.querySelector<HTMLIFrameElement>("iframe.viewer-iframe")!;
  try {
    await act(async () => root.render(<Workspace />));
    await until(host, () => host.querySelectorAll("[data-atom]").length === 3, "initial atoms");
    assert.equal(
      controller.ownsCurrentSourceFrame(target, activeFrame()),
      true,
      "ordinary unedited viewer has no source session",
    );
    await pick(activeFrame().contentWindow!, 2);
    assert.equal(host.querySelector('[data-atom="2"]')?.getAttribute("aria-selected"), "true");
    const up = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Move up",
    )!;
    await click(up);
    await until(
      host,
      () =>
        controller.sessionForDocument(target)?.dirty &&
        host.querySelector('[data-atom="1"]')?.textContent.includes("O2"),
      "the reordered draft",
    );
    const live = controller.sessionForDocument(target)!;
    const preview = live.sourcePreview!;
    assert.notEqual(live.content, source, "draft source has committed");
    assert.equal(
      preview.slots[preview.activeSlot]?.runtimePath,
      target.runtimePath,
      "the active runtime still owns the original source",
    );
    assert.equal(
      preview.slots[preview.activeSlot]?.identity,
      undefined,
      "no replacement has promoted",
    );
    const old = activeFrame(),
      oldWindow = old.contentWindow!;
    let captureRequest: string | null = null;
    oldWindow.postMessage = (message: unknown) => {
      const body = (message as { body?: { type?: string; requestId?: string } })?.body;
      if (body?.type === "captureRendererViewState") captureRequest = body.requestId!;
    };
    assert.equal(
      controller.ownsCurrentSourceFrame(target, old),
      false,
      "queued draft rejects its legitimate but old scene",
    );
    await pick(oldWindow, 2);
    assert.equal(
      host.querySelector('[data-atom="1"]')?.getAttribute("aria-selected"),
      "true",
      "old O3 does not become editable C3",
    );
    await until(host, () => captureRequest, "the actual held camera transport");
    await pick(oldWindow, 0);
    assert.equal(
      host.querySelector('[data-atom="1"]')?.getAttribute("aria-selected"),
      "true",
      "old selection remains rejected during staging",
    );
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: oldWindow,
          data: {
            source: "burette-viewer",
            body: {
              type: "rendererViewStateCaptured",
              requestId: captureRequest,
              documentId: target.id,
              viewState: { camera: { position: [0, 0, 10] } },
              viewport: { width: 640, height: 480 },
            },
          },
        }),
      ),
    );
    await until(
      host,
      () => Boolean(host.querySelector('iframe[data-source-preview-role="staging"]')),
      "the real candidate frame",
    );
    const current = controller.sessionForDocument(target)!.sourcePreview!;
    const candidate = current.slots[current.activeSlot === "primary" ? "secondary" : "primary"]!;
    const staged = host.querySelector<HTMLIFrameElement>(
      'iframe[data-source-preview-role="staging"]',
    )!;
    assert.equal(
      staged.dataset.sourcePreviewRequestId,
      candidate.identity!.requestId,
      "actual ViewerFrame writes the request identity",
    );
    assert.equal(
      controller.ownsCurrentSourceFrame(target, staged),
      false,
      "unpromoted candidate has no authority",
    );
    await act(async () => controller.stagingLoaded(target, candidate.identity!, staged));
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: staged.contentWindow,
          data: {
            source: "burette-viewer",
            body: { type: "ready", renderer: "molstar", molstarStructureCount: 1 },
          },
        }),
      ),
    );
    await until(
      host,
      () => activeFrame() === staged && controller.ownsCurrentSourceFrame(target, staged),
      "promotion and current revision acknowledgement",
    );
    await pick(staged.contentWindow!, 2);
    assert.equal(
      host.querySelector('[data-atom="2"]')?.getAttribute("aria-selected"),
      "true",
      "promoted source index2 now really is C3",
    );
    await pick(oldWindow, 0);
    assert.equal(
      host.querySelector('[data-atom="2"]')?.getAttribute("aria-selected"),
      "true",
      "late old-window selection cannot overwrite the promoted owner",
    );
    assert.equal(
      controller.ownsCurrentSourceFrame(target, old),
      false,
      "old request identity remains invalid after promotion",
    );
    const revision = staged.dataset.sourcePreviewRevision!;
    staged.dataset.sourcePreviewRevision = String(Number(revision) + 1);
    await pick(staged.contentWindow!, 0);
    assert.equal(
      host.querySelector('[data-atom="2"]')?.getAttribute("aria-selected"),
      "true",
      "a mismatched runtime revision is rejected",
    );
    staged.dataset.sourcePreviewRevision = revision;
    const inPlace = controller.sessionForDocument(target)!.content + "\n";
    await act(async () => controller.updateDraft(target, inPlace, { previewApplied: true }));
    await until(
      host,
      () => graph.history?.current.text === inPlace,
      "the acknowledged in-place source snapshot",
    );
    assert.equal(
      controller.ownsCurrentSourceFrame(target, staged),
      true,
      "an acknowledged in-place update retains its runtime authority",
    );
    await pick(staged.contentWindow!, 0);
    assert.equal(
      host.querySelector('[data-atom="0"]')?.getAttribute("aria-selected"),
      "true",
      "current in-place runtime can still select atoms",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}, 15000);
