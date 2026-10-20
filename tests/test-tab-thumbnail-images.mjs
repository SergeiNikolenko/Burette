import assert from "node:assert/strict";
import { Window } from "happy-dom";

const browser = new Window({ url: "http://localhost" });
const originalGlobals = new Map();
for (const [key, value] of Object.entries({ window: browser, document: browser.document,
  // Happy DOM shares frame constructors; give the shell a distinct constructor
  // to exercise the realm boundary present in real srcdoc frames.
  HTMLImageElement: class ShellImageElement {},
})) {
  originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

const { captureTabThumbnail, pruneTabThumbnails } = await import("../apps/desktop/src/components/editor-area/tab-thumbnails.ts");
const page = browser.document.createElement("div");
page.className = "page-surface";
page.setAttribute("data-active", "");
browser.document.body.append(page);
const frame = browser.document.createElement("iframe");
const history = browser.document.createElement("div");
history.hidden = true;
const oldFrame = browser.document.createElement("iframe");
history.append(oldFrame);
const current = browser.document.createElement("div");
current.className = "tab-history-page";
current.append(frame);
page.append(history, current);
const picture = frame.contentDocument.createElement("img");
frame.contentDocument.body.append(picture);
Object.defineProperties(picture, { complete: { value: true }, naturalWidth: { value: 200 } });
assert.equal(picture instanceof globalThis.HTMLImageElement, false);
const rect = { x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 };
for (const element of [page, frame, picture]) element.getBoundingClientRect = () => rect;
const drawn = [];
let encoded = 0;
browser.HTMLCanvasElement.prototype.getContext = () => ({
  fillRect() {}, scale() {}, drawImage: (...args) => drawn.push(args),
});
browser.HTMLCanvasElement.prototype.toDataURL = () => { encoded++; return "data:image/jpeg;base64,AA=="; };

try {
  await captureTabThumbnail("image-tab");
  assert.deepEqual(drawn, [[picture, 0, 0, 200, 100]]);
  assert.equal(encoded, 1, "the current frame must produce a thumbnail even with older hidden history first");
  current.hidden = true;
  await captureTabThumbnail("image-tab");
  assert.equal(encoded, 1, "hidden history must never supply a stale tab thumbnail");
} finally {
  pruneTabThumbnails(new Set());
  await browser.happyDOM.close();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
console.log("Cross-realm iframe thumbnail image test passed");
