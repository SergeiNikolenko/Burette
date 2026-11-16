import { expect, test } from "bun:test";
import { act } from "react";
import { readFileSync } from "node:fs";
import { fixture } from "./measurement-pair-fixture";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
const { useGraphDraft } = await import("../apps/desktop/src/components/workbench/use-graph-draft");

const ethanol = readFileSync(new URL("./fixtures/fragments/ethanol-cid702.sdf", import.meta.url), "utf8");

test("fragment insertion is one exact source Undo step through the real worker, keeping SDF data and atom identities", async () => {
  const view = await fixture("sdf", useGraphDraft, ethanol);
  try {
    const before = view.graph.history!.current;
    const hydroxyl = before.structure.atoms.findIndex((atom, i) => atom.element === "H" && before.structure.bonds.some(bond => (bond.a === i && before.structure.atoms[bond.b].element === "O") || (bond.b === i && before.structure.atoms[bond.a].element === "O")));
    const result = await view.apply({ kind: "insert-fragment", fragment: { source: "library", id: "alkanes/ethyl" }, target: hydroxyl });
    expect(result).not.toBeNull();
    const after = view.graph.history!.current;
    expect(view.graph.error).toBeNull();
    // Diethyl ether: C4H10O, 15 atoms; the replaced hydroxyl H is the only source atom that disappears.
    expect(after.structure.atoms).toHaveLength(15);
    expect(after.structure.atoms.map(atom => atom.element).sort().join("")).toBe("CCCCHHHHHHHHHHO");
    expect(after.structure.sourceAtomIndices.filter(i => i >= 0).sort((a, b) => a - b)).toEqual(before.structure.atoms.map((_, i) => i).filter(i => i !== hydroxyl));
    const ids = after.metadata!.atoms.map(atom => atom.id);
    after.structure.sourceAtomIndices.forEach((source, i) => { if (source >= 0) expect(ids[i]).toBe(before.metadata!.atoms[source].id); });
    expect(new Set(ids).size).toBe(15);
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(after.text);
    // The written draft is an ordinary SDF record that reopens with the same graph and PubChem data items.
    expect(after.text).toContain("> <PUBCHEM_COMPOUND_CID>");
    const reopened = parseMolecule(after.text, "sdf");
    expect(reopened.atoms).toEqual(after.structure.atoms);
    expect(reopened.bonds).toEqual(after.structure.bonds);
    await act(async () => view.graph.undo());
    expect(view.graph.history!.current).toBe(before);
    expect(view.controller.sessionForDocument(view.doc)?.content).toBe(before.text);
    await act(async () => view.graph.redo());
    expect(view.graph.history!.current).toBe(after);
  } finally { await view.close(); }
});

test("a refused insertion leaves the draft and its history untouched", async () => {
  const view = await fixture("sdf", useGraphDraft, ethanol);
  try {
    const before = view.graph.history!.current;
    expect(await view.apply({ kind: "insert-fragment", fragment: { source: "smiles", smiles: "*C*" }, target: 0 })).toBeNull();
    expect(view.graph.error).toContain("at most one attachment point");
    expect(view.graph.history!.current).toBe(before);
    expect(view.graph.history!.undo).toEqual([]);
    // The worker refused before any write, so no editing session (and no draft) was opened.
    expect(view.controller.sessionForDocument(view.doc)).toBeNull();
  } finally { await view.close(); }
});
