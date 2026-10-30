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
const openedDocument = (title: string) => ({ id: `routed-${++documents}`, title, path: `/${title}`, runtimePath: `/${title}`, byteCount: 0, extension: "xyz", renderer: "molstar" as const });

test("ordinary opens send quantum outputs to the scientific import and leave other files alone", async () => {
  const cases: Array<[string, string, boolean]> = [
    ["dvb.fchk", "garbage", true],
    ["DVB.FCH", "", true],
    ["h.molden", molden, true],
    ["h.molf", molden, true],
    ["molden.input", molden, true],
    ["water.molden.input", molden, true],
    ["water.hess", "$orca_hessian_file\n", true],
    ["density.cube", "", true],
    ["phenol.cub", "", true],
    ["orca.out", orcaBanner, true],
    ["scan.log", "CARTESIAN COORDINATES (ANGSTROEM)\n", true],
    ["gaussian.log", " Entering Gaussian System, Link 0=g16\n", true],
    ["notes.log", "build finished\n", false],
    ["vasp.out", "running on 4 total cores\n", false],
    // Only the start of a log is read; an ORCA marker deep inside other text does not claim it.
    ["late.out", `${"x".repeat(70 * 1024)}\n${orcaBanner}`, false],
    ["water.xyz", "3\n\nO 0 0 0\nH 1 0 0\nH 0 1 0\n", false],
    ["ethanol.sdf", "ethanol\n", false],
    ["settings.input", "key=value\n", false],
  ];
  const results = await Promise.all(cases.map(([name, text]) => isScientificFile(file(name, text))));
  assert.deepEqual(cases.map(([name], index) => [name, results[index]]), cases.map(([name, , expected]) => [name, expected]));
  const { scientific, other } = await partitionScientificFiles([file("a.sdf", "a"), file("b.fchk", "b"), file("c.log", "c")]);
  assert.deepEqual([scientific.map((item) => item.name), other.map((item) => item.name)], [["b.fchk"], ["a.sdf", "c.log"]]);
});

test("recognised files parse and open with their science attached; a broken one opens nothing", async () => {
  const opened: Array<{ path: string; inputExtension: string; text: string }> = [];
  const toasts: Array<{ title?: unknown; description?: unknown }> = [];
  const add = toast.add;
  toast.add = ((options: { title?: unknown; description?: unknown }) => { toasts.push(options); return ""; }) as typeof toast.add;
  try {
    const actions = { openStructureRecords: async (records: typeof opened) => { opened.push(...records); return records.map((record) => openedDocument(record.path)); } };
    await openScientificFiles(actions, [file("h.molden", molden), file("broken.fchk", "not a checkpoint\n"), file("empty.molden", "[Molden Format]\n")]);
    assert.equal(opened.length, 1, "only the valid Molden file opens; no geometry fallback for the broken ones");
    assert.equal(opened[0].path, "h.xyz");
    assert.equal(opened[0].inputExtension, "xyz");
    assert.match(opened[0].text, /^1\n.*import-[0-9a-f]{8}.*\nH\s/u);
    assert.deepEqual(toasts.map((item) => item.title), ["Could not open broken.fchk", "Could not open empty.molden"]);
    assert.ok(toasts.every((item) => typeof item.description === "string" && item.description.length > 0));

    toasts.length = 0;
    await openScientificFiles(actions, Array.from({ length: 17 }, (_, index) => file(`h${index}.molden`, molden)));
    assert.equal(opened.length, 1, "more files than the bound open none");
    assert.deepEqual(toasts.map((item) => item.title), ["Open up to 16 quantum outputs at a time"]);
  } finally { toast.add = add; }
});

test("one unreadable file fails alone; the others still open by their own route", async () => {
  const unreadable = (name: string) => {
    const item = file(name, "unreadable");
    const reject = () => Promise.reject(new DOMException("The file changed on disk.", "NotReadableError"));
    Object.defineProperty(item, "slice", { value: () => ({ text: reject }) });
    Object.defineProperty(item, "text", { value: reject });
    return item;
  };
  const helium = file("helium.xyz", "1\nhelium\nHe 0 0 0\n");
  const { scientific, other } = await partitionScientificFiles([unreadable("failed.log"), helium, file("h.molden", molden)]);
  assert.deepEqual([scientific.map((item) => item.name), other.map((item) => item.name)], [["h.molden"], ["failed.log", "helium.xyz"]]);
  // The ordinary drop keeps helium and reports the log's read error by name.
  const dropped = await structureDragPayloadFromBrowserFiles(other);
  assert.deepEqual(dropped.payload.records.map((record) => record.path), ["helium.xyz"]);
  assert.equal(dropped.errors.length, 1);
  assert.match(dropped.errors[0], /^failed\.log: /u);

  // A recognised file that cannot be read reports its own error and never falls back to geometry; the rest still open.
  const opened: string[] = [];
  const toasts: unknown[] = [];
  const add = toast.add;
  toast.add = ((options: { title?: unknown }) => { toasts.push(options.title); return ""; }) as typeof toast.add;
  try {
    await openScientificFiles({ openStructureRecords: async (records) => { opened.push(...records.map((record) => record.path)); return records.map((record) => openedDocument(record.path)); } }, [unreadable("dvb.fchk"), file("h.molden", molden)]);
  } finally { toast.add = add; }
  assert.deepEqual([opened, toasts], [["h.xyz"], ["Could not open dvb.fchk"]]);
});
