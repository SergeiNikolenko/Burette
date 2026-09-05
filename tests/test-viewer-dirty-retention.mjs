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
