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
