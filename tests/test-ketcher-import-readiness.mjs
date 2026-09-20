import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the actual transfer loop with a delayed chemical service. A local
// MOL import must paint even while that service is still unavailable.
const source = readFileSync("apps/desktop/src/components/ketcher-page.tsx", "utf8");
const start = source.indexOf("async function importKetcherStructure(");
const end = source.indexOf("async function loadKetcherImportCandidate(", start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
let releaseService;
const serviceReady = new Promise((resolve) => { releaseService = resolve; });
const events = [];
const transfer = runInNewContext(code + "\nimportKetcherStructure", {
  looksLikeMolBlock: (text) => text.includes("M  END"),
  looksLikeReactionBlock: (text) => text.startsWith("$RXN"),
  waitForKetcherStructServiceReady: async () => {
    events.push("wait-service");
    await serviceReady;
  },
  loadKetcherImportCandidate: (candidate, load) => load(candidate),
  waitForKetcherCanvasUpdate: async () => { events.push("paint"); },
});
await transfer({}, ["M  END"], async () => { events.push("load-mol"); });
assert.deepEqual(events, ["load-mol", "paint"]);
events.length = 0;
const reaction = transfer({}, ["$RXN\nM  END"], async () => { events.push("load-reaction"); });
await Promise.resolve();
assert.deepEqual(events, ["wait-service"]);
releaseService();
await reaction;
assert.deepEqual(events, ["wait-service", "load-reaction", "paint"]);
events.length = 0;
await transfer({}, ["CCO"], async () => { events.push("load-smiles"); });
assert.deepEqual(events, ["wait-service", "load-smiles", "paint"]);
console.log("Ketcher import readiness tests passed");

const editor = readFileSync("apps/desktop/src/components/ketcher-editor.tsx", "utf8");
const loaderSource = editor.slice(editor.indexOf("let runtimePromise:"), editor.indexOf("export function KetcherEditor("))
  .replace("export function", "function").replaceAll("import(", "loadModule(");
const loaderCode = ts.transpileModule(loaderSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
let shimReady = false;
let fail = true;
const imports = [];
const loadRuntime = runInNewContext(loaderCode + "\nloadKetcherRuntime", {
  installKetcherBrowserRequire() {},
  installRaphaelBrowserModules() { shimReady = true; },
  async loadModule(name) {
    imports.push(name);
    if (name.startsWith("ketcher-")) assert.ok(shimReady, "Raphael must be ready before Ketcher modules");
    if (fail && name === "raphael") throw new Error("load failed");
    return {};
  },
});
const failedLoad = loadRuntime();
assert.equal(loadRuntime(), failedLoad, "concurrent callers share initialization");
await assert.rejects(failedLoad, /load failed/);
fail = false;
const retry = loadRuntime();
assert.notEqual(retry, failedLoad, "failed initialization can be retried");
await retry;
const loadedImports = imports.length;
assert.equal(loadRuntime(), retry);
assert.equal(imports.length, loadedImports, "mount reuses preloaded runtime");
console.log("Ketcher runtime loading tests passed");
