import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { act, test, expect, fixture, dialog, button, click, input, select, wait, workers, holdWorker, workerHeld, releaseWorker,
  prepared, holdPreparation, releasePreparation, readBrowserDevVirtualTextDocument, openWorkbenchDialog, closeWorkbenchDialog, compiler,
  buildShellCommands, filterShellCommands, browser } from "./peptide-builder-fixture";
import { buildPeptideGeometry } from "../apps/desktop/src/lib/molecular-workbench/peptide-geometry";
import { peptideMmcif } from "../apps/desktop/src/lib/molecular-workbench/peptide-mmcif";
import type { ShellViewState } from "../apps/desktop/src/components/types";
const require = createRequire(import.meta.url);
const { CIF } = require("@molstar/io/reader/cif");
const { trajectoryFromMmCIF } = require("@molstar/model/formats/structure/mmcif");
const { Structure, StructureProperties: P, StructureElement } = require("@molstar/model/model/structure");
const { to_mmCIF } = require("@molstar/model/model/structure/export/mmcif");
async function nativeStructure(text: string) { const parsed = await CIF.parse(text).run(); expect(parsed.isError).toBe(false); return Structure.ofModel((await trajectoryFromMmCIF(parsed.result.blocks[0]).run()).representative); }
function snapshot(structure: any) {
  const loc = StructureElement.Location.create(structure), atoms: unknown[] = [], bonds: string[] = [], ids = new Map<string, number>();
  for (const unit of structure.units) for (let i = 0; i < unit.elements.length; i++) {
    loc.unit = unit; loc.element = unit.elements[i]; ids.set(`${unit.id}:${i}`, atoms.length);
    atoms.push([P.atom.label_atom_id(loc), P.atom.label_comp_id(loc), P.residue.label_seq_id(loc), P.chain.label_asym_id(loc), P.atom.pdbx_formal_charge(loc)]);
  }
  for (const unit of structure.units) for (let e = 0; e < unit.bonds.a.length; e++) {
    const { a, b, edgeProps } = unit.bonds; if (a[e] >= b[e]) continue;
    const x = ids.get(`${unit.id}:${a[e]}`)!, y = ids.get(`${unit.id}:${b[e]}`)!; bonds.push(`${Math.min(x, y)}:${Math.max(x, y)}:${edgeProps.order[e]}`);
  }
  expect(structure.interUnitBonds.edgeCount).toBe(0); return { atoms, bonds: bonds.sort() };
}

test("native controls → real worker preview → exact new document → actual viewer export/reopen", async () => {
  const f = await fixture();
  try {
    expect(button("Create").disabled).toBe(true);
    await input("Sequence", "Pro-Gly-Ile"); await click("Three letters"); await click("D");
    await select("Backbone", "alpha");
    await act(async () => dialog()!.querySelector('[aria-label="Phi, degrees"]')!.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event));
    await input("Phi, degrees", "-87");
    expect(dialog()!.querySelector<HTMLSelectElement>('select[aria-label="Backbone"]')!.value).toBe("custom");
    await select("N-terminus", "ammonium"); await select("C-terminus", "carboxylate"); await input("Chain", "7");
    await click("Preview"); await wait(() => Boolean(dialog()?.querySelector("iframe")), "exact preview");
    const frame = dialog()!.querySelector("iframe")!;
    const encoded = JSON.parse(frame.srcdoc.match(/id="burette-inspector-input">([^]*?)<\/script>/)![1]);
    const preview = Buffer.from(encoded.data, "base64").toString();
    const model = buildPeptideGeometry("PGI", { phi: -87, psi: -40, chirality: "D", nTerminus: "ammonium", cTerminus: "carboxylate", chain: "7" });
    expect(preview).toBe(peptideMmcif(model)); expect(encoded.config.molstarFormat).toBe("mmcif");
    await click("Create"); await wait(() => !dialog(), "new document opened");
    expect(workers).toHaveLength(1); expect(f.opened).toHaveLength(1);
    const opened = f.opened[0]; expect(readBrowserDevVirtualTextDocument(opened.path)).toBe(preview);
    expect(opened.title).toBe("Peptide PGI.cif");
    const structure = await nativeStructure(preview), expected = { atoms: model.atoms.map(a => [a.name, a.residue, a.residueNumber, a.chain, a.charge]), bonds: model.bonds.map(b => `${Math.min(b.a,b.b)}:${Math.max(b.a,b.b)}:${b.order}`).sort() };
    expect(snapshot(structure)).toEqual(expected);
    const source = readFileSync("PreviewExtension/Web/viewer.js", "utf8"), start = source.indexOf("  function molstarModifiedMmCifExportPayload() {");
    const end = source.indexOf("\n  function ", start + 1); expect(start).toBeGreaterThan(0);
    const exported = new Function("molstarExportToMmCif", "molstarCurrentStructuresForExport", "molstarExportFileName", `${source.slice(start,end)};return molstarModifiedMmCifExportPayload();`)(() => to_mmCIF, () => [{ name: "Peptide PGI", structure }], () => opened.title);
    expect(exported.name).toBe(opened.title); expect(snapshot(await nativeStructure(exported.text))).toEqual(expected);
    expect(compiler).toContain("peptide-builder.tsx"); expect(compiler).toContain("peptide-builder-host.tsx");
  } finally { await f.close(); }
});

test("duplicate Create is one request; cancel held real worker, retry and same-kind replacement retain ownership", async () => {
  const f = await fixture();
  try {
    await input("Sequence", "GG"); holdWorker();
    const create = button("Create"); await act(async () => { create.click(); create.click(); });
    await wait(workerHeld, "held actual worker reply"); expect(workers).toHaveLength(1); expect(button("Create").disabled).toBe(true);
    await click("Cancel"); expect(workers[0].terminated).toBe(true); await act(async () => releaseWorker()); expect(f.opened).toEqual([]);
    holdWorker(); await click("Create"); await wait(workerHeld, "second held worker");
    await act(async () => openWorkbenchDialog({ kind: "builder", builder: "peptide", document: null }));
    await wait(() => dialog()?.querySelector<HTMLInputElement>('input[aria-label="Sequence"]')?.value === "", "fresh form");
    await act(async () => releaseWorker()); expect(f.opened).toEqual([]);
    await input("Sequence", "G"); await click("Create"); await wait(() => f.opened.length === 1, "retry publication");
    expect(f.opened[0].title).toBe("Peptide G.cif");
  } finally { await f.close(); }
});

test("cancel after actual document preparation drops its source; failed open keeps preview for a safe retry", async () => {
  const f = await fixture();
  try {
    await input("Sequence", "PG"); holdPreparation(); await click("Create"); await wait(() => prepared.length === 1, "real prepared document");
    const stale = prepared[0]; expect(readBrowserDevVirtualTextDocument(stale.path)).toBeString();
    await click("Cancel"); await act(async () => releasePreparation()); await wait(() => readBrowserDevVirtualTextDocument(stale.path) === null, "unadopted source cleanup"); expect(f.opened).toEqual([]);
    f.failOpen(true); await click("Create"); await wait(() => Boolean(dialog()?.querySelector('[role="alert"]')), "open error");
    expect(dialog()?.querySelector("iframe")).not.toBeNull(); expect(workers).toHaveLength(1);
    f.failOpen(false); await click("Create"); await wait(() => f.opened.length === 1, "open retry"); expect(workers).toHaveLength(1);
  } finally { await f.close(); }
});

test("palette activates only the peptide host and validation recovers without closing the form", async () => {
  const f = await fixture();
  try {
    const commands = buildShellCommands({ activeDocument: null, documents: [], tabs: [], recentStructures: [], preferences: { rendererMode: "auto" } } as unknown as ShellViewState, f.actions, "peptide");
    expect(filterShellCommands(commands, "peptide").some(command => command.id === "workbench-peptide")).toBe(true);
    await act(async () => { closeWorkbenchDialog(); commands.find(command => command.id === "workbench-peptide")!.run(); });
    await wait(() => Boolean(dialog()?.querySelector('input[aria-label="Sequence"]')), "palette form");
    await input("Sequence", "BAD!"); await click("Create"); await wait(() => Boolean(dialog()?.querySelector('[role="alert"]')), "sequence error"); expect(f.opened).toEqual([]);
    await input("Sequence", "G"); await click("Create"); await wait(() => f.opened.length === 1, "corrected sequence");
    await f.open(); await input("Sequence", "G"); await click("Create"); await wait(() => f.opened.length === 2, "second explicit Create");
    expect(f.opened[0].path).not.toBe(f.opened[1].path); expect(f.opened[0].id).not.toBe(f.opened[1].id);
    expect(readBrowserDevVirtualTextDocument(f.opened[0].path)).toBe(readBrowserDevVirtualTextDocument(f.opened[1].path));
  } finally { await f.close(); }
});

test("changing preview inputs discards stale bytes; closing a prepared request cannot publish into another dialog", async () => {
  const f = await fixture();
  try {
    await input("Sequence", "G"); await click("Preview"); await wait(() => Boolean(dialog()?.querySelector("iframe")), "first preview");
    await input("Sequence", "PP"); expect(dialog()?.querySelector("iframe")).toBeNull();
    await select("Backbone", "beta"); holdPreparation(); await click("Create"); await wait(() => prepared.length === 1, "new request prepared");
    const stale = prepared[0]; expect(readBrowserDevVirtualTextDocument(stale.path)).toBe(peptideMmcif(buildPeptideGeometry("PP", { phi: -135, psi: 135 })));
    await act(async () => { openWorkbenchDialog({ kind: "builder", builder: "nucleic", document: null }); releasePreparation(); });
    await wait(() => readBrowserDevVirtualTextDocument(stale.path) === null, "replaced request cleanup");
    expect(f.opened).toEqual([]); expect(dialog()).toBeNull(); expect(workers).toHaveLength(2);
  } finally { await f.close(); }
});
