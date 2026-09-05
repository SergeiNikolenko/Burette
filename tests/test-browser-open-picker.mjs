import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const path = "apps/desktop/src/hooks/use-app-open-actions.ts";
const original = process.argv[2]
  ? execFileSync("git", ["show", `${process.argv[2]}:${path}`], { encoding: "utf8" })
  : readFileSync(path, "utf8");
const source = new Bun.Transpiler({ loader: "ts" }).transformSync(original.replace(/^import .*;\n/gm, "").replace("export function", "function"));
const hook = new Function("useCallback", "isTauriRuntime", "isWebDemoWorkspace", "pickWebDemoFiles", "open", "previewFormatRegistry", source + "\nreturn useAppOpenActions;")(
  fn => fn, () => false, () => false, async () => ({ paths: ["/OpenedFiles/a.sdf"] }),
  () => { throw new Error("Native dialog invoked in browser"); }, { documentTypes: { extensions: [] } },
);
const opened = [], errors = [];
await hook({ openPaths: paths => opened.push(paths), openStructureRecords() {}, pushErrorStatus: error => errors.push(error.message), pushStatus() {}, recentStructures: [] }).chooseFiles();
assert.deepEqual(errors, []);
assert.deepEqual(opened, [["/OpenedFiles/a.sdf"]], "generic browser Open must use the browser file picker");
console.log("Browser Open picker checks passed.");
