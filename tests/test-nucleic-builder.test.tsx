import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { act, test, expect, fixture, dialog, button, click, input, select, wait, workers, holdWorker, workerHeld, releaseWorker,
  prepared, holdPreparation, releasePreparation, readBrowserDevVirtualTextDocument, openWorkbenchDialog, compiler } from "./nucleic-builder-fixture";
import { buildNucleicAcid, nucleicAcidMmcif } from "../apps/desktop/src/lib/molecular-workbench/nucleic";
const require = createRequire(import.meta.url);
const { CIF } = require("molstar/lib/commonjs/mol-io/reader/cif.js");
const { trajectoryFromMmCIF } = require("molstar/lib/commonjs/mol-model-formats/structure/mmcif.js");
const { Structure, StructureProperties: P, StructureElement } = require("molstar/lib/commonjs/mol-model/structure.js");
const { to_mmCIF } = require("molstar/lib/commonjs/mol-model/structure/export/mmcif.js");

// Atom counts shown while typing are RDKit's (tests/fixtures/nucleic/rdkit-references.json).
const RDKIT: { cases: { type: string; sequence: string; fivePrime: string; strands: string; atoms: number }[] } =
  JSON.parse(readFileSync(new URL("./fixtures/nucleic/rdkit-references.json", import.meta.url), "utf8"));
const atoms = (type: string, sequence: string, fivePrime: string, strands: string) =>
  `${RDKIT.cases.find((item) => item.type === type && item.sequence === sequence && item.fivePrime === fivePrime && item.strands === strands)!.atoms} atoms`;
async function nativeStructure(text: string) { const parsed = await CIF.parse(text).run(); expect(parsed.isError).toBe(false); return Structure.ofModel((await trajectoryFromMmCIF(parsed.result.blocks[0]).run()).representative); }
function snapshot(structure: any) {
  const loc = StructureElement.Location.create(structure), rows: unknown[] = [], bonds: string[] = [], ids = new Map<string, number>();
  for (const unit of structure.units) for (let i = 0; i < unit.elements.length; i++) {
    loc.unit = unit; loc.element = unit.elements[i]; ids.set(`${unit.id}:${i}`, rows.length);
    rows.push([P.atom.label_atom_id(loc), P.atom.label_comp_id(loc), P.residue.label_seq_id(loc), P.chain.label_asym_id(loc), P.atom.pdbx_formal_charge(loc)]);
  }
  for (const unit of structure.units) for (let e = 0; e < unit.bonds.a.length; e++) {
    const { a, b, edgeProps } = unit.bonds; if (a[e] >= b[e]) continue;
    const x = ids.get(`${unit.id}:${a[e]}`)!, y = ids.get(`${unit.id}:${b[e]}`)!; bonds.push(`${Math.min(x, y)}:${Math.max(x, y)}:${edgeProps.order[e]}`);
  }
  expect(structure.interUnitBonds.edgeCount).toBe(0); return { rows, bonds: bonds.sort() };
}
const alert = () => dialog()?.querySelector('[role="alert"]')?.textContent ?? null;
const count = () => dialog()?.querySelector(".workbench-value")?.textContent ?? null;
const segment = (group: string, label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] [role="radio"]`)].find((node) => node.textContent === label)!;
const checked = (group: string) => [...dialog()!.querySelectorAll(`[aria-label="${group}"] [role="radio"][aria-checked="true"]`)].map((node) => node.textContent);
const previewText = async () => {
  const frame = dialog()!.querySelector("iframe")!;
  const encoded = JSON.parse(frame.srcdoc.match(/id="burette-inspector-input">([^]*?)<\/script>/)![1]);
  expect([encoded.config.molstarFormat, encoded.data]).toEqual(["mmcif", undefined]);
  return (await fetch(encoded.dataURL)).text();
};

test("the sequence is validated while typing; RNA disables B and Z with the reason; invalid input never reaches the worker", async () => {
  const f = await fixture();
  try {
    expect([button("Preview").disabled, button("Create").disabled, alert(), count()]).toEqual([true, true, null, null]);
    expect([checked("Nucleic acid"), checked("Helix"), checked("Strands")]).toEqual([["DNA"], ["B-form"], ["Duplex"]]);
    await input("Sequence", "GATTACU");
    const field = dialog()!.querySelector<HTMLInputElement>('input[aria-label="Sequence"]')!;
    expect([alert(), field.getAttribute("aria-invalid"), button("Create").disabled]).toEqual(["U is an RNA base. Use T, or choose RNA.", "true", true]);
    expect(field.getAttribute("aria-describedby")).toBe(dialog()!.querySelector('[role="alert"]')!.id);
    await input("Sequence", "gatt aca");
    expect([alert(), field.getAttribute("aria-invalid"), button("Create").disabled, count()]).toEqual([null, "false", false, atoms("DNA", "GATTACA", "hydroxyl", "double")]);
    await click("Single strand"); expect(count()).toBe(atoms("DNA", "GATTACA", "hydroxyl", "single"));
    await select("5′ end", "phosphate"); expect(count()).toBe(atoms("DNA", "GATTACA", "phosphate", "single"));
    await click("Z-form");
    expect([alert(), button("Preview").disabled]).toEqual(["Z-DNA needs alternating pyrimidines and purines, such as CGCG or CACA. Nucleotides 1 and 2 are both purines.", true]);
    await input("Sequence", "CACGTG"); expect([alert(), count()]).toEqual([null, atoms("DNA", "CACGTG", "phosphate", "single")]);
    await click("RNA");
    expect([checked("Helix"), segment("Helix", "B-form").disabled, segment("Helix", "A-form").disabled, segment("Helix", "Z-form").disabled]).toEqual([["A-form"], true, false, true]);
    const group = dialog()!.querySelector('[aria-label="Helix"]')!;
    expect(dialog()!.querySelector(`[id="${group.getAttribute("aria-describedby")}"]`)!.textContent).toBe("RNA is built only as an A-form helix.");
    expect(alert()).toBe("T is a DNA base. Use U, or choose DNA.");
    await input("Sequence", "GAUUACA"); expect([alert(), count()]).toEqual([null, atoms("RNA", "GAUUACA", "phosphate", "single")]);
    await input("Sequence", "A".repeat(501)); expect([alert(), button("Create").disabled]).toEqual(["Use at most 500 nucleotides per strand.", true]);
    // DNA again restores the user's Z choice.
    await input("Sequence", "CGCG"); await click("DNA"); expect([checked("Helix"), group.getAttribute("aria-describedby")]).toEqual([["Z-form"], null]);
    expect(workers).toHaveLength(0);
  } finally { await f.close(); }
});

test("real worker preview → exact new mmCIF document → actual viewer export and reopen", async () => {
  const f = await fixture();
  try {
    await input("Sequence", "cacgtg"); await click("Z-form"); await select("5′ end", "phosphate");
    await click("Preview"); await wait(() => Boolean(dialog()?.querySelector("iframe")), "exact preview");
    const preview = await previewText();
    const model = buildNucleicAcid("CACGTG", { type: "DNA", form: "Z", strands: "double", fivePrime: "phosphate" });
    expect(preview).toBe(nucleicAcidMmcif(model, "CACGTG-Z-DNA-duplex-ideal"));
    await click("Create"); await wait(() => !dialog(), "new document opened");
    expect(workers).toHaveLength(1); expect(f.opened).toHaveLength(1);
    const opened = f.opened[0];
    expect([opened.title, readBrowserDevVirtualTextDocument(opened.path)]).toEqual(["CACGTG-Z-DNA-duplex-ideal.cif", preview]);
    const structure = await nativeStructure(preview);
    const expected = { rows: model.atoms.map((atom) => [atom.name, atom.residue, atom.seq, atom.chain, atom.charge]), bonds: model.bonds.map((bond) => `${Math.min(bond.a, bond.b)}:${Math.max(bond.a, bond.b)}:${bond.order}`).sort() };
    expect(snapshot(structure)).toEqual(expected);
    // Save through the viewer's own mmCIF export, then reopen what it wrote.
    const source = readFileSync("PreviewExtension/Web/viewer.js", "utf8"), start = source.indexOf("  function molstarModifiedMmCifExportPayload() {");
    const end = source.indexOf("\n  function ", start + 1); expect(start).toBeGreaterThan(0);
    const exported = new Function("molstarExportToMmCif", "molstarCurrentStructuresForExport", "molstarExportFileName", `${source.slice(start, end)};return molstarModifiedMmCifExportPayload();`)(() => to_mmCIF, () => [{ name: "CACGTG_Z_DNA", structure }], () => opened.title);
    expect(exported.name).toBe(opened.title); expect(snapshot(await nativeStructure(exported.text))).toEqual(expected);
    expect(compiler).toContain("nucleic-builder.tsx"); expect(compiler).toContain("nucleic-builder-host.tsx");
  } finally { await f.close(); }
});

test("duplicate Create is one request; Cancel terminates the held worker; retry and same-kind replacement keep ownership", async () => {
  const f = await fixture();
  try {
    await input("Sequence", "ACGT"); holdWorker();
    const create = button("Create"); await act(async () => { create.click(); create.click(); });
    await wait(workerHeld, "held worker reply"); expect(workers).toHaveLength(1);
    expect([button("Create").disabled, dialog()!.querySelector('[role="status"] [aria-label]')?.getAttribute("aria-label")]).toEqual([true, "Creating structure…"]);
    await click("Cancel"); expect(workers[0].terminated).toBe(true); await act(async () => releaseWorker()); expect(f.opened).toEqual([]);
    expect(dialog()?.querySelector<HTMLInputElement>('input[aria-label="Sequence"]')?.value).toBe("ACGT");
    holdWorker(); await click("Create"); await wait(workerHeld, "second held worker");
    await act(async () => openWorkbenchDialog({ kind: "builder", builder: "nucleic", document: null }));
    await wait(() => dialog()?.querySelector<HTMLInputElement>('input[aria-label="Sequence"]')?.value === "", "fresh form");
    await act(async () => releaseWorker()); expect(f.opened).toEqual([]);
    await input("Sequence", "GC"); await click("Create"); await wait(() => f.opened.length === 1, "retry publication");
    expect(f.opened[0].title).toBe("GC-B-DNA-duplex-ideal.cif");
  } finally { await f.close(); }
});

test("cancel during document preparation drops it; a failed open keeps the preview for a safe retry; edits discard stale previews", async () => {
  const f = await fixture();
  try {
    await input("Sequence", "GATC"); holdPreparation(); await click("Create"); await wait(() => prepared.length === 1, "prepared document");
    const stale = prepared[0]; expect(readBrowserDevVirtualTextDocument(stale.path)).toBeString();
    await click("Cancel"); await act(async () => releasePreparation());
    await wait(() => readBrowserDevVirtualTextDocument(stale.path) === null, "unadopted source cleanup"); expect(f.opened).toEqual([]);
    f.failOpen(true); await click("Create"); await wait(() => Boolean(alert()), "open error");
    expect([alert(), Boolean(dialog()?.querySelector("iframe")), workers.length]).toEqual(["Could not open the structure. Try Create again.", true, 1]);
    f.failOpen(false); await click("Create"); await wait(() => f.opened.length === 1, "open retry"); expect(workers).toHaveLength(1);
    await f.open(); await input("Sequence", "GATC"); await click("Preview"); await wait(() => Boolean(dialog()?.querySelector("iframe")), "preview");
    await click("Single strand"); expect(dialog()?.querySelector("iframe")).toBeNull();
  } finally { await f.close(); }
});
