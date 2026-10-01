import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { clearRegionSelection, describeRegion } from "../apps/desktop/src/lib/annotation-region";

const window = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window, document: window.document, HTMLIFrameElement: window.HTMLIFrameElement });
const layer = document.createElement("div");
const frames = [document.createElement("iframe"), document.createElement("iframe")];
document.body.append(layer, ...frames);
const actions: string[][] = [[], []];
for (const [index, frame] of frames.entries()) {
  frame.className = "viewer-iframe";
  const target = frame.contentWindow!;
  target.postMessage = ((message: { body: { id: string; action: { type: string } } }) => {
    actions[index].push(message.body.action.type);
    queueMicrotask(() => window.dispatchEvent(new window.MessageEvent("message", {
      source: target,
      data: { source: "burette-agent-viewer", body: { type: "agent-action-result", id: message.body.id,
        result: { ok: true, result: { surface: "molstar", atomCount: 1 } } } },
    })));
  }) as typeof target.postMessage;
}
try {
  document.elementsFromPoint = () => [frames[0]];
  const rect = { left: 10, top: 10, width: 20, height: 20 };
  const target = await describeRegion(layer, rect, "atom");
  assert.equal(target?.surface, "molstar");
  // The old page is hidden and another page visible by the time cleanup runs.
  frames[0].style.display = "none";
  document.elementsFromPoint = () => [frames[1]];
  clearRegionSelection([{ id: 1, rect, pin: { x: 10, y: 10 }, comment: "Old page", target }]);
  assert.deepEqual(actions, [["describe_region", "clear_selection"], []]);
  assert.deepEqual(Object.keys(target!), ["surface", "atomCount"], "Frame ownership stays out of serialized context");
} finally {
  await window.happyDOM.close();
}
console.log("Annotation cleanup only clears the originating molecular page");
