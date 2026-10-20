import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { activeViewerIframeForDocument, postMessageToViewerSource } from "../apps/desktop/src/lib/viewer-bridge";
import { dockCameraRestore, prepareDockCameraTransfer, rememberDockCamera } from "../apps/desktop/src/lib/dock-camera-transfer";
import type { ViewerDocument } from "../apps/desktop/src/types";

const browser = new Window();
Object.assign(globalThis, { document: browser.document, CSS: browser.CSS });

test("duplicate documents route to the visible scene before warm history, including pane and read-only views", () => {
  document.body.innerHTML = `
    <div class="page-surface" data-active="true">
      <div class="tab-history-page" hidden><iframe id="history" class="viewer-iframe" data-document-id="a" data-renderer="molstar"></iframe></div>
      <div class="tab-history-page"><iframe id="current" class="viewer-iframe" data-document-id="b" data-renderer="molstar"></iframe></div>
    </div>
    <div class="page-surface" data-pane="floating" data-pane-shown="visible">
      <div class="tab-history-page"><iframe id="pane" class="viewer-iframe" data-document-id="a" data-renderer="molstar"></iframe></div>
    </div>`;
  const history = document.querySelector<HTMLIFrameElement>("#history")!;
  const pane = document.querySelector<HTMLIFrameElement>("#pane")!;
  const current = document.querySelector<HTMLIFrameElement>("#current")!;
  const resolve = () => activeViewerIframeForDocument("a", "molstar");
  expect(resolve()).toBe(pane);
  expect(activeViewerIframeForDocument("b")).toBe(current);
  const messages: unknown[] = [];
  pane.contentWindow!.postMessage = message => { messages.push(message); };
  const payload = { body: { documentId: "a", type: "targeted-command" } };
  postMessageToViewerSource(null, payload);
  expect(messages).toEqual([payload]);

  pane.closest(".page-surface")!.setAttribute("data-pane", "floating");
  expect(resolve()).toBe(pane);
  pane.dataset.readOnly = "true";
  expect(resolve()).toBe(pane);
  pane.closest(".page-surface")!.setAttribute("data-pane-shown", "minimized");
  expect(resolve()).toBe(history);
  pane.closest(".page-surface")!.setAttribute("data-pane-shown", "visible");
  history.parentElement!.removeAttribute("hidden");
  expect(resolve()).toBe(history);
  history.parentElement!.setAttribute("hidden", "");
  pane.setAttribute("aria-hidden", "true");
  expect(resolve()).toBe(history);
  expect(activeViewerIframeForDocument("missing")).toBeNull();
  document.body.replaceChildren();
});

test("explicit transfer authenticates the source and keeps the pane camera independent across remounts", async () => {
  Object.assign(globalThis, { window: browser });
  document.body.innerHTML = `<iframe class="viewer-iframe" data-document-id="transfer" data-renderer="molstar" id="source"></iframe>
    <aside class="dock-panel" data-area="right"><iframe class="viewer-iframe" data-document-id="transfer" data-read-only="true" id="dock"></iframe></aside>`;
  const source = document.querySelector<HTMLIFrameElement>("#source")!.contentWindow!;
  const dock = document.querySelector<HTMLIFrameElement>("#dock")!;
  const panel = dock.parentElement!;
  dock.remove();
  const viewState = { camera: { position: [12, 4, 8], target: [1, 2, 3], up: [0, 1, 0], radius: 4 } };
  const viewport = { width: 1200, height: 800 };
  let captures = 0;
  source.postMessage = message => {
    captures++;
    const body = { type: "rendererViewStateCaptured", documentId: "transfer", requestId: message.body.requestId, viewState, viewport };
    browser.dispatchEvent(new browser.MessageEvent("message", { source: dock.contentWindow, data: { source: "burette-viewer", body } }));
    expect(dockCameraRestore(dock.contentWindow, "transfer")).toBeUndefined();
    browser.dispatchEvent(new browser.MessageEvent("message", { source, data: { source: "burette-viewer", body } }));
  };
  const doc = { id: "transfer", renderer: "molstar" } as ViewerDocument;
  await prepareDockCameraTransfer("right", doc);
  panel.append(dock);
  expect(dockCameraRestore(source, "transfer")).toBeUndefined();
  expect(dockCameraRestore(dock.contentWindow, "transfer")).toEqual({ viewState: JSON.stringify(viewState), sourceViewport: viewport });
  const adjusted = { camera: { ...viewState.camera, position: [23, 6, 13] } };
  expect(rememberDockCamera(source, "transfer", viewState)).toBe(false);
  expect(rememberDockCamera(dock.contentWindow, "transfer", adjusted)).toBe(true);
  expect(dockCameraRestore(dock.contentWindow, "transfer")).toEqual({ viewState: JSON.stringify(adjusted) });
  const replacement = dock.cloneNode() as HTMLIFrameElement;
  dock.replaceWith(replacement);
  await prepareDockCameraTransfer("right", doc);
  expect(captures).toBe(1);
  expect(dockCameraRestore(replacement.contentWindow, "transfer")).toEqual({ viewState: JSON.stringify(adjusted) });
  expect(dockCameraRestore(replacement.contentWindow, "legacy")).toBeUndefined();
  replacement.dataset.documentId = "mounted";
  document.querySelector<HTMLIFrameElement>("#source")!.dataset.documentId = "mounted";
  await prepareDockCameraTransfer("right", { id: "mounted", renderer: "molstar" } as ViewerDocument);
  expect(captures).toBe(1);
  expect(dockCameraRestore(replacement.contentWindow, "mounted")).toBeUndefined();
  document.body.replaceChildren();
});
