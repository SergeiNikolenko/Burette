import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { activeViewerIframeForDocument, postMessageToViewerSource } from "../apps/desktop/src/lib/viewer-bridge";

const browser = new Window();
Object.assign(globalThis, { document: browser.document, CSS: browser.CSS });

test("duplicate documents route to the visible scene before warm history, including pane and read-only views", () => {
  document.body.innerHTML = `
    <div class="page-surface" data-active="true">
      <div class="tab-history-page" hidden><iframe id="history" class="viewer-iframe" data-document-id="a" data-renderer="molstar"></iframe></div>
      <div class="tab-history-page"><iframe id="current" class="viewer-iframe" data-document-id="b" data-renderer="molstar"></iframe></div>
    </div>
    <div class="page-surface" data-pane="side" data-pane-shown="visible">
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
