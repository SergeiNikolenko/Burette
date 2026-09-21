import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync("apps/desktop/src/components/editor-area/index.tsx", "utf8");
const start = source.indexOf("function warmMountedTabs(");
const end = source.indexOf("\nfunction sameStringArray", start);
const javascript = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));
const retain = new Function("pageKind", `${javascript}; return warmMountedTabs;`)(() => ({ keepAlive: true }));
const tabs = Array.from({ length: 11 }, (_, i) => ({ id: `tab-${i}`, location: { kind: "file" } }));
for (const limit of [4, 6, 10]) {
  const mounted = retain(tabs, 10, tabs.map(tab => tab.id), limit, new Set(["tab-0"]));
  assert.equal(mounted.has("tab-0"), true, `dirty iframe must survive the ${limit}-page budget`);
  assert.equal(mounted.has("tab-10"), true);
  assert.equal(mounted.size, limit + 1);
}
console.log("Dirty viewer retention checks passed.");
const firstOpen = retain(tabs, 0, [], 10, new Set());
assert.deepEqual([...firstOpen], ["tab-0"], "opening many files must not initialize unvisited viewers");
assert.deepEqual([...retain(tabs, 4, ["tab-0", "tab-2"], 10, new Set())], ["tab-4", "tab-2", "tab-0"]);
console.log("Visited-only viewer warmup checks passed.");

const limitStart = source.indexOf("function mountedWarmPageLimit()");
const limitJs = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(limitStart, start));
const nativeLimit = new Function("window", `${limitJs}; return mountedWarmPageLimit();`)({ BuretteMcpWorkspace: {} });
const visited = tabs.slice(0, 8).map(tab => tab.id);
assert.deepEqual([...retain(tabs, 0, visited, nativeLimit, new Set())].sort(), [...visited].sort(),
  "cycling through eight native documents must retain every visited renderer");
const afterClose = tabs.filter(tab => tab.id !== "tab-3");
assert.equal(retain(afterClose, 0, visited, nativeLimit, new Set()).has("tab-3"), false,
  "closing a tab releases its retained page");
assert.deepEqual([...retain(tabs, 0, [], nativeLimit, new Set())], ["tab-0"],
  "native retention must not eagerly initialize unseen documents");
console.log("Native document retention checks passed.");

// Render the actual page stack: keys alone do not protect iframe contexts from
// DOM moves, so reordering the strip must leave page nodes in place.
const { Window } = await import("happy-dom");
const React = await import("react");
const ts = (await import("typescript")).default;
const jsx = await import("react/jsx-runtime");
const dom = new Window({ url: "http://localhost/" });
for (const [name, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator })) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
window.BuretteMcpWorkspace = {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const Page = ({ tabId }) => React.createElement("iframe", { title: tabId });
const modules = {
  react: React, "react/jsx-runtime": jsx,
  "./page-kinds": { pageKind: () => ({ kind: "file", keepAlive: true, Component: Page }) },
};
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const exports = {};
new Function("require", "exports", code)(name => { assert.ok(modules[name], name); return modules[name]; }, exports);
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
let state = { tabs: tabs.slice(0, 8), activeTabId: "tab-0", dirtyGridDocuments: new Set() };
const render = async () => React.act(() => root.render(React.createElement(exports.ViewerArea, { state, actions: {} })));
await render();
assert.equal(container.querySelectorAll("iframe").length, 1);
for (const tab of state.tabs) { state = { ...state, activeTabId: tab.id }; await render(); }
const pageNodes = [...container.querySelector(".page-stack").children];
assert.equal(pageNodes.length, 8, "all eight visited native pages stay mounted");
const mutations = [];
const observer = new dom.MutationObserver(records => mutations.push(...records));
observer.observe(container.querySelector(".page-stack"), { childList: true });
state = { ...state, tabs: [...state.tabs].reverse(), activeTabId: "tab-0" };
await render();
mutations.push(...observer.takeRecords());
assert.deepEqual([...container.querySelector(".page-stack").children], pageNodes,
  "reordering the strip must preserve iframe DOM order");
assert.equal(mutations.length, 0, "no retained page can be removed/reinserted during reorder");
assert.equal(container.querySelector('.page-surface[data-active] iframe').title, "tab-0");
state = { ...state, tabs: state.tabs.filter(tab => tab.id !== "tab-3") };
await render();
assert.equal(container.querySelectorAll("iframe").length, 7, "explicit close releases only that page");
observer.disconnect();
await React.act(() => root.unmount());
await dom.happyDOM.close();
console.log("Native page-stack mount, reorder isolation and close checks passed.");
