import assert from "node:assert/strict";
import { Window } from "happy-dom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useChemicalSpaceSetting } from "../apps/desktop/src/hooks/use-chemical-space-setting.ts";

const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const setters = new Map();
function Panel({ id, collection }) {
  const [dimensions, setDimensions] = useChemicalSpaceSetting(collection, "dimensions", 2);
  const [activity, setActivity] = useChemicalSpaceSetting(collection, "activity", null);
  setters.set(id, { setDimensions, setActivity });
  return React.createElement("output", { id }, JSON.stringify({ dimensions, activity }));
}
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
const render = (panels) => act(() => root.render(React.createElement(React.Fragment, null,
  ...panels.map(([id, collection]) => React.createElement(Panel, { key: id, id, collection })))));
const read = id => JSON.parse(document.getElementById(id).textContent);
await render([["right", "collection-a"], ["bottom", "collection-a"], ["other", "collection-b"]]);
await act(() => { setters.get("right").setDimensions(3); setters.get("right").setActivity("pIC50"); });
assert.deepEqual(read("right"), { dimensions: 3, activity: "pIC50" });
assert.deepEqual(read("bottom"), read("right"));
assert.deepEqual(read("other"), { dimensions: 2, activity: null });
await act(() => setters.get("bottom").setDimensions(value => value === 3 ? 2 : 3));
assert.deepEqual(read("right"), { dimensions: 2, activity: "pIC50" });
await render([]);
await render([["reopened", "collection-a"]]);
assert.deepEqual(read("reopened"), { dimensions: 2, activity: "pIC50" });
await render([["reopened", "new-runtime-a"]]);
assert.deepEqual(read("reopened"), { dimensions: 2, activity: null });
await act(() => root.unmount());
console.log("Chemical Space dock settings: sync, remount and runtime isolation passed");
