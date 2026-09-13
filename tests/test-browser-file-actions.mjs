import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile("apps/desktop/src/hooks/use-app-file-actions.ts", "utf8");
const executable = ts.transpile(source.replace(/^import[\s\S]*?;\n/gm, "").replace("export function", "function"));
const calls = [];
const statuses = [];
let native = false;
const context = {
  useCallback: callback => callback,
  isTauriRuntime: () => native,
  invoke: async (...args) => calls.push(args),
  openPath: async (...args) => calls.push(["openPath", ...args]),
  basename: path => path.split("/").pop(),
  args: { activeDocument: null, activeTextDocument: null, activeDocumentTabPath: null,
    pushStatus: (...args) => statuses.push(args),
    pushErrorStatus: error => { throw error; }, writeClipboardText: async () => {} },
};
vm.runInNewContext(`${executable}\nthis.actions = useAppFileActions(args);`, context);
await context.actions.openPathInChemicalEditor("/demo.pdb", "chimerax", "ChimeraX");
await context.actions.openPathWithDefaultApp("/demo.pdb");
await context.actions.revealPath("/demo.pdb");
assert.deepEqual(calls, [], "Browser actions must not call native APIs");
assert.equal(statuses.length, 3);
assert.ok(statuses.every(([message, kind]) => kind === "info" && message.includes("Burette for Mac")));
native = true;
await context.actions.openPathInChemicalEditor("/demo.pdb", "chimerax", "ChimeraX");
await context.actions.openPathWithDefaultApp("/demo.pdb");
await context.actions.revealPath("/demo.pdb");
assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
  ["open_in_chemical_editor", { path: "/demo.pdb", targetId: "chimerax" }],
  ["openPath", "/demo.pdb"], ["reveal_path", { path: "/demo.pdb" }],
]);
console.log("Browser availability and native file actions passed.");
