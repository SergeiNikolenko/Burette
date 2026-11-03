import { expect, test } from "bun:test";
import { act } from "react";
import { readFileSync } from "node:fs";
import initRDKitModule from "@rdkit/rdkit";
import { fixture } from "./measurement-pair-fixture";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
const { useGraphDraft } = await import("../apps/desktop/src/components/workbench/use-graph-draft");

const glycine = readFileSync(new URL("./fixtures/protonation/glycine.sdf", import.meta.url), "utf8");
const rdkit = await (initRDKitModule as unknown as () => Promise<{ get_mol: (text: string, details?: string) => { get_smiles: () => string; delete: () => void } | null }>)();
const smiles = (text: string) => { const mol = rdkit.get_mol(text, JSON.stringify({ removeHs: true })); if (!mol) throw new Error("RDKit could not read the draft."); try { return mol.get_smiles(); } finally { mol.delete(); } };

test("adjusting hydrogens for pH is one Undo step whose SDF draft RDKit reads as the expected charge state", async () => {
  const view = await fixture("sdf", useGraphDraft, glycine);
  try {
    const before = view.graph.history!.current;
    expect(await view.apply({ kind: "protonate", pH: 7.4 })).not.toBeNull();
    const zwitterion = view.graph.history!.current;
    expect(view.graph.error).toBeNull();
    expect(smiles(zwitterion.text)).toBe(smiles("[NH3+]CC(=O)[O-]"));
    // Heavy atoms keep their source identity and coordinates; only hydrogens change.
    const heavy = (structure: typeof before.structure) => structure.atoms.flatMap((atom, i) => atom.element === "H" ? [] : [[i, atom] as const]);
    for (const [i, atom] of heavy(zwitterion.structure)) expect(atom).toEqual(before.structure.atoms[zwitterion.structure.sourceAtomIndices[i]]);
    expect(zwitterion.structure.atoms).toHaveLength(10);
    expect(parseMolecule(zwitterion.text, "sdf").atoms).toEqual(zwitterion.structure.atoms);
    expect(await view.apply({ kind: "protonate", pH: 1 })).not.toBeNull();
    expect(smiles(view.graph.history!.current.text)).toBe(smiles("[NH3+]CC(=O)O"));
    await act(async () => view.graph.undo());
    expect(view.graph.history!.current).toBe(zwitterion);
    await act(async () => view.graph.undo());
    expect(view.graph.history!.current).toBe(before);
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(before.text);
  } finally { await view.close(); }
}, 60_000);

test("an out-of-range pH is refused without touching the draft", async () => {
  const view = await fixture("sdf", useGraphDraft, glycine);
  try {
    const before = view.graph.history!.current;
    expect(await view.apply({ kind: "protonate", pH: 15 })).toBeNull();
    expect(view.graph.error).toContain("Choose a pH from 0 to 14.");
    expect([view.graph.history!.current, view.graph.history!.undo]).toEqual([before, []]);
  } finally { await view.close(); }
});
