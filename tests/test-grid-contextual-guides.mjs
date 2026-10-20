import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The grid frame asks the app shell for its one-time guides with the anchor's
// rect; the shell owns eligibility, so the frame may ask on every action.
const source = readFileSync("PreviewExtension/Web/grid-viewer.js", "utf8");
function declaration(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = source.slice(start + 1).search(/\n  (?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}

const posted = [];
const anchor = (left) => ({ getBoundingClientRect: () => ({ left, top: 20, width: 30, height: 40, right: left + 30, bottom: 60 }) });
const anchors = { '[aria-label="Grid view mode"]': anchor(1), "grid-controls": anchor(2) };
const document = { querySelector: (selector) => anchors[selector] ?? null, getElementById: (id) => anchors[id] ?? null };
const frame = { parent: { postMessage: (message, origin) => posted.push({ message, origin }) } };
const requestContextualGuide = new Function("window", `${declaration("requestContextualGuide")}\nreturn requestContextualGuide;`)(frame);
const guide = (id, left) => ({ message: { type: "burette:contextual-guide", id, rect: { left, top: 20, width: 30, height: 40 } }, origin: "*" });
const app = { appViewer: true };

// Cards / Table switch.
const callback = source.match(/      onViewModeChange\(value\) \{[\s\S]*?\n      \},/)?.[0];
assert.ok(callback, "the toolbar view-mode callback");
const switched = [];
const controls = (cfg) => new Function("setGridViewMode", "requestContextualGuide", "document", "cfg", `return {${callback}};`)(
  (value) => switched.push(value), requestContextualGuide, document, cfg,
);
controls(app).onViewModeChange("table");
assert.deepEqual(switched, ["table"]);
assert.deepEqual(posted.splice(0), [guide("grid", 1)], "switching Cards/Table anchors the grid guide to the switch");
controls({ appViewer: false }).onViewModeChange("cards");
assert.deepEqual(posted, [], "Quick Look and hosted grids have no guide host");

// Structure search.
const state = { query: "", smarts: "", smartsMatches: new Map(), searchTimer: 0, token: 0, dataToken: 0 };
const timers = [];
let matches = new Map();
const search = new Function(
  "state", "capabilities", "setTimeout", "clearTimeout", "refresh", "refreshGridControls", "requestContextualGuide", "document",
  ["queryLooksLikeExplicitSMARTS", "queryLooksLikeSMILESFragment", "queryLooksLikeSMARTS", "setUnifiedSearchQuery", "scheduleSearch"]
    .map(declaration).join("\n") + "\nreturn scheduleSearch;",
)(
  state, () => ({ substructureSearch: true }), (fn) => timers.push(fn), () => {},
  async () => { state.smartsMatches = state.smarts ? matches : new Map(); }, () => {}, requestContextualGuide, document,
);
const run = async (query) => { search(query, app); await timers.pop()(); };
await run("aspirin");
assert.deepEqual(posted, [], "a text search is not a structure search");
await run("c1ccccc1");
assert.deepEqual(posted, [], "a structure search without matches has nothing highlighted to explain");
matches = new Map([[0, { atoms: [0, 1, 2, 3, 4, 5], bonds: [] }]]);
await run("c1ccccc1");
assert.deepEqual(posted.splice(0), [guide("smarts-search", 2)], "matches anchor the guide below the whole toolbar, clear of the search field");

frame.parent = frame;
requestContextualGuide("grid", anchors["grid-controls"], app);
assert.deepEqual(posted, [], "a top-level grid has no parent shell to ask");

console.log("Grid contextual guides: Cards/Table switch and structure search request their guides.");
