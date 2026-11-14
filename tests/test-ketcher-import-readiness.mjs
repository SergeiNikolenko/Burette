import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript-compiler-api";

// Exercise the actual transfer loop with a delayed editor. The shared frame
// loads MOL directly and a reaction is ready only after its own import paints.
const source = readFileSync("apps/desktop/src/components/ketcher-page.tsx", "utf8");
const start = source.indexOf("async function importKetcherStructure(");
const end = source.indexOf("async function loadKetcherImportCandidate(", start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
let releaseReaction;
const reactionReady = new Promise((resolve) => { releaseReaction = resolve; });
const events = [];
const transfer = runInNewContext(code + "\nimportKetcherStructure", {
  loadKetcherImportCandidate: (candidate, load) => load(candidate),
  waitForKetcherCanvasUpdate: async () => { events.push("paint"); },
});
const reaction = transfer({}, ["$RXN\nM  END"], async () => {
  await reactionReady;
  events.push("load-reaction");
});
await transfer({}, ["M  END"], async () => { events.push("load-mol"); });
assert.deepEqual(events, ["load-mol", "paint"]);
releaseReaction();
await reaction;
assert.deepEqual(events, ["load-mol", "paint", "load-reaction", "paint"]);
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

// Every Indigo service assigns `onmessage` on the window's one worker when it is
// created. The reaction editor's service must not silence the codec's service.
const { shareIndigoWorker } = await import("../apps/desktop/src/lib/molecular-codecs.ts");
const worker = {};
const replies = [];
const indigoService = (name) => {
  worker.onmessage = (event) => replies.push(`${name}:${event.data}`);
  return { worker };
};
shareIndigoWorker("codecs", indigoService("codecs"));
shareIndigoWorker("editor", indigoService("editor"));
shareIndigoWorker("editor", indigoService("remounted editor"));
worker.onmessage({ data: "reply" });
assert.deepEqual(replies, ["codecs:reply", "remounted editor:reply"]);
console.log("Indigo worker sharing test passed");
