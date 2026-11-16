import { expect, test } from "bun:test";
import { act } from "react";
import { readFileSync } from "node:fs";
import initRDKitModule from "@rdkit/rdkit";
import { browser, fixture } from "./measurement-pair-fixture";
import { runPeptideTask } from "../apps/desktop/src/lib/workbench/peptide-task";
import { runMetalComplexTask } from "../apps/desktop/src/lib/workbench/metal-complex-task";
const { useGraphDraft } = await import("../apps/desktop/src/components/workbench/use-graph-draft");
const { InsertBuiltStructureButton } = await import("../apps/desktop/src/components/workbench/insert-built-structure");

const ethanol = readFileSync(new URL("./fixtures/fragments/ethanol-cid702.sdf", import.meta.url), "utf8");
const rdkit = await (initRDKitModule as unknown as () => Promise<{ get_mol: (text: string, details?: string) => { get_smiles: () => string; delete: () => void } | null }>)();
const smiles = (text: string) => { const mol = rdkit.get_mol(text, JSON.stringify({ removeHs: true }))!; try { return mol.get_smiles(); } finally { mol.delete(); } };

test("a built peptide inserts into the open SDF as a separate molecule in one Undo step", async () => {
  // The real peptide worker, as the builder dialog runs it.
  const build = async () => (await runPeptideTask({ sequence: "AG", codes: "one", options: { chirality: "L", phi: -60, psi: -40, nTerminus: "ammonium", cTerminus: "carboxylate", chain: "A" } })).graph;
  const view = await fixture("sdf", useGraphDraft, ethanol, document => <InsertBuiltStructureButton document={document} name="Peptide AG" build={build} />);
  try {
    const before = view.graph.history!.current, button = view.host.querySelector<HTMLButtonElement>("button")!;
    expect([button.textContent, button.title, button.disabled]).toEqual(["Insert", "Insert into source.sdf", false]);
    await act(async () => { button.dispatchEvent(new browser.MouseEvent("click", { bubbles: true }) as unknown as Event); });
    await view.settle(() => view.graph.history!.current !== before || Boolean(view.host.querySelector('[role="alert"]')));
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBeUndefined();
    const after = view.graph.history!.current;
    // RDKit reads the draft as ethanol plus the Ala-Gly zwitterion; ethanol atoms are untouched.
    expect(smiles(after.text)).toBe(smiles("CCO.C[C@H]([NH3+])C(=O)NCC(=O)[O-]"));
    expect(after.structure.atoms.slice(0, 9)).toEqual(before.structure.atoms);
    expect(after.structure.sourceAtomIndices).toEqual([...before.structure.atoms.map((_, i) => i), ...Array(after.structure.atoms.length - 9).fill(-1)]);
    expect(view.host.querySelector('[role="status"]')?.textContent).toBe("Inserted");
    await act(async () => view.graph.undo());
    expect(view.graph.history!.current).toBe(before);
  } finally { await view.close(); }
}, 60_000);

test("a built metal complex inserts with its coordination as dative bonds", async () => {
  const complex = await runMetalComplexTask({ metal: "Pt", oxidationState: 2, geometry: "square-planar", format: "sdf",
    ligands: [{ ligand: "chlorido", sites: [0] }, { ligand: "chlorido", sites: [1] }, { ligand: "ammine", sites: [2] }, { ligand: "ammine", sites: [3] }] });
  const { atoms, bonds, coordination } = complex.graph;
  const build = async () => ({ atoms, bonds: [...bonds, ...coordination.map(({ a, b }) => ({ a, b, order: 9 as const }))] });
  const view = await fixture("sdf", useGraphDraft, ethanol, document => <InsertBuiltStructureButton document={document} name={complex.name} build={build} />);
  try {
    const before = view.graph.history!.current;
    await act(async () => { view.host.querySelector("button")!.dispatchEvent(new browser.MouseEvent("click", { bubbles: true }) as unknown as Event); });
    await view.settle(() => view.graph.history!.current !== before || Boolean(view.host.querySelector('[role="alert"]')));
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBeUndefined();
    const after = view.graph.history!.current;
    // The draft writes the four metal–donor edges as MDL dative bonds, and RDKit reads ethanol plus the builder's own complex.
    expect([after.text.match(/^M {2}V30 \d+ 9 /gmu)?.length, after.structure.bonds.filter(bond => bond.order === 9).length]).toEqual([4, 4]);
    expect(smiles(after.text)).toBe(smiles(`CCO.${smiles(complex.text)}`));
    await act(async () => view.graph.undo());
    expect(view.graph.history!.current).toBe(before);
  } finally { await view.close(); }
}, 60_000);

test("a builder failure is shown and leaves the document untouched", async () => {
  const view = await fixture("sdf", useGraphDraft, ethanol, document => <InsertBuiltStructureButton document={document} name="Peptide" build={() => Promise.reject(new Error("Unknown residue B."))} />);
  try {
    const before = view.graph.history!.current;
    await act(async () => { view.host.querySelector("button")!.dispatchEvent(new browser.MouseEvent("click", { bubbles: true }) as unknown as Event); });
    await view.settle(() => Boolean(view.host.querySelector('[role="alert"]')));
    expect(view.host.querySelector('[role="alert"]')!.textContent).toBe("Unknown residue B.");
    expect([view.graph.history!.current, view.graph.history!.undo]).toEqual([before, []]);
  } finally { await view.close(); }
});
