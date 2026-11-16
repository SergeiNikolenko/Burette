import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "bun:test";
import { isScientificFile, partitionScientificFiles } from "../apps/desktop/src/lib/workbench/scientific-files";
import { openScientificFiles } from "../apps/desktop/src/lib/workbench/open";
import { structureDragPayloadFromBrowserFiles } from "../apps/desktop/src/lib/structure-drag";
import { toast } from "../apps/desktop/src/components/ui/toast";

const molden = "[Molden Format]\n[Atoms] AU\nH 1 1 0 0 0\n[GTO]\n1 0\ns 1 1.00\n1.0D+00 1.0\n[MO]\nEne= -0.5\nSpin= Alpha\nOccup= 1\n1 1.0\n";
const orcaBanner = "\n                                 * O   R   C   A *\n\n   Program Version 6.0.0\n";
const file = (name: string, text: string) => new File([text], name);
// The open resolves with the documents it created.
let documents = 0;
const openedDocument = (title: string) => ({ id: `routed-${++documents}`, title, path: `/${title}`, extension: "xyz", renderer: "molstar" as const });

test("the browser file picker hands quantum outputs over before the workspace file limit", async () => {
  const { pickWebDemoFiles } = await import("../apps/desktop/src/lib/web-demo-workspace");
  // A real formatted checkpoint is often larger than the 3 MB browser workspace file limit.
  const checkpoint = new File(["x".repeat(4 * 1024 * 1024)], "dvb.fchk");
  const picked = [checkpoint, file("ethanol.sdf", "ethanol\n  RDKit\n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END\n$$$$\n")];
  let accept = "";
  const input = { type: "", hidden: false, multiple: false, accept: "", files: picked, listeners: new Map<string, () => void>(),
    setAttribute() {}, remove() {}, addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); },
    click() { accept = this.accept; this.listeners.get("change")?.(); } };
  const previous = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: { createElement: () => input, body: { append() {} } } });
  try {
    const result = await pickWebDemoFiles();
    assert.deepEqual({ paths: result?.paths, scientific: result?.scientific },
      { paths: ["/OpenedFiles/ethanol.sdf"], scientific: ["/OpenedFiles/dvb.fchk"] });
    assert.ok([".fchk", ".molden", ".hess", ".cube", ".log"].every((extension) => accept.split(",").includes(extension)), accept);
  } finally { Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: previous }); }
});

test("the browser file picker keeps every readable file when one cannot be read or added", async () => {
  const { pickWebDemoFiles } = await import("../apps/desktop/src/lib/web-demo-workspace");
  const failed = file("failed.log", "unreadable");
  const reject = () => Promise.reject(new DOMException("The file changed on disk.", "NotReadableError"));
  Object.defineProperty(failed, "slice", { value: () => ({ text: reject }) });
  Object.defineProperty(failed, "text", { value: reject });
  const pick = async (files: File[]) => {
    const input = { type: "", hidden: false, multiple: false, accept: "", files, listeners: new Map<string, () => void>(),
      setAttribute() {}, remove() {}, addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); },
      click() { this.listeners.get("change")?.(); } };
    const previous = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: { createElement: () => input, body: { append() {} } } });
    try { return await pickWebDemoFiles(); } finally { Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: previous }); }
  };
  const result = await pick([failed, file("helium.xyz", "1\nhelium\nHe 0 0 0\n"), file("h.molden", molden), file("big.pdb", "x".repeat(4 * 1024 * 1024))]);
  assert.deepEqual({ paths: result?.paths, scientific: result?.scientific, errors: result?.errors },
    { paths: ["/OpenedFiles/helium.xyz"], scientific: ["/OpenedFiles/h.molden"],
      errors: ["failed.log: The file changed on disk.", "big.pdb: larger than the 3 MB browser file limit"] });
  const oversize = await pick([file("oversize.fchk", "x".repeat(16 * 1024 * 1024 + 1))]);
  assert.deepEqual(oversize, { root: "/OpenedFiles", paths: [], scientific: [], errors: ["oversize.fchk: larger than the 16 MiB browser file limit"] });
  // Nothing readable: the errors still come back for the status, never a silent cancel.
  assert.deepEqual(await pick([failed]), { root: "/OpenedFiles", paths: [], scientific: [], errors: ["failed.log: The file changed on disk."] });
});
