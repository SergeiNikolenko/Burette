import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../ios/BuretteMobile/MobilePreviewWebView.swift", import.meta.url), "utf8");
const expression = source.match(/evaluateJavaScript\("(\(\(\) => \{ const bridge[^\n]+)"\) \{ result, error/)[1]
  .replace("\\(panelState.jsonString)", '{"left":true,"right":false}');
assert.equal(runInNewContext(expression, { window: {} }), false);
assert.equal(runInNewContext(expression, { window: { BuretteMobileControls: {} } }), false);
let applied;
assert.equal(runInNewContext(expression, {
  window: { BuretteMobileControls: { setLayout(state) { applied = state; } } },
}), true);
assert.deepEqual(JSON.parse(JSON.stringify(applied)), { left: true, right: false });
assert.throws(() => runInNewContext(expression, {
  window: { BuretteMobileControls: { setLayout() { throw new Error("not ready"); } } },
}), /not ready/);
console.log("mobile panel ACK: absent bridge, valid layout, and failed application passed");

// WKNavigation.didFinish only means the HTML loaded; Mol* initializes later.
// Keep commands pending until the current generation receives the viewer ready event.
const cancel = source.slice(source.indexOf("func cancelPreparation()"), source.indexOf("func removeRetiredRuntimes()"));
assert.match(cancel, /generation = UUID\(\)[\s\S]*readyGeneration = nil/);
for (const method of ["runControlAction", "runContextMenuCommand"]) {
  const start = source.indexOf(`func ${method}(`);
  const body = source.slice(start, source.indexOf("\n        func ", start + 1));
  assert.match(body, /guard readyGeneration == generation/);
  assert.ok(body.indexOf("guard readyGeneration") < body.indexOf("pendingActionID = action.id") ||
    body.indexOf("guard readyGeneration") < body.indexOf("pendingContextCommandID = command.id"));
}
const finish = source.slice(source.indexOf("func webView("), source.indexOf("func userContentController("));
assert.doesNotMatch(finish, /readyGeneration\s*=/);
const receive = source.slice(source.indexOf("func userContentController("));
const readyStart = receive.indexOf('else if type == "ready"');
assert.ok(receive.indexOf("guard self.generation == requestGeneration") < readyStart);
const ready = receive.slice(readyStart, receive.indexOf('else if type == "action"'));
assert.ok(ready.indexOf("self.readyGeneration = requestGeneration") < ready.indexOf("self.runControlAction"));
assert.ok(ready.indexOf("self.readyGeneration = requestGeneration") < ready.indexOf("self.runContextMenuCommand"));
console.log("mobile command readiness: navigation cannot consume commands before current viewer ready");
