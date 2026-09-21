import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync("apps/desktop/src/components/editor-area/page-kinds/fep-network.tsx", "utf8");
const start = source.indexOf("function fepGridHtml(");
const end = source.indexOf("\nfunction cssEscape(", start);
assert.ok(start >= 0 && end > start);
const transpiler = new Bun.Transpiler({ loader: "ts" });
const makeHtml = runInNewContext(`${transpiler.transformSync(source.slice(start, end))}\nfepGridHtml;`, {
  gridAssetsBaseUrl: "http://localhost/assets/",
  gridAssetVersion: "test",
  escapeHtml: (value) => value.replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
});
const hostile = '</script><script>window.injected=true</script><!--';
const records = [{ index: 0, name: hostile, molblock: `title\n${hostile}`, props: { note: hostile } }];
const html = makeHtml(hostile, records);
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((match) => match[1]);
const context = { window: {} };
for (const script of scripts) runInNewContext(script, context);
assert.equal(context.window.injected, undefined, "record/title text must never become executable HTML");
assert.equal(context.window.BuretteConfig.label, hostile);
assert.deepEqual(JSON.parse(JSON.stringify(context.window.BuretteGridRecords)), records);
console.log("FEP grid inline data round-trip and script isolation passed");
