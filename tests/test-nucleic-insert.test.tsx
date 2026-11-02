import { expect, test } from "bun:test";
import { act } from "react";
import { readFileSync } from "node:fs";
import initRDKitModule from "@rdkit/rdkit";
import { browser, fixture } from "./measurement-pair-fixture";
import { runNucleicTask } from "../apps/desktop/src/lib/workbench/nucleic-task";
const { useGraphDraft } = await import("../apps/desktop/src/components/workbench/use-graph-draft");
const { InsertBuiltStructureButton } = await import("../apps/desktop/src/components/workbench/insert-built-structure");

const ethanol = readFileSync(new URL("./fixtures/fragments/ethanol-cid702.sdf", import.meta.url), "utf8");
// RDKit's own GATTACA strand (Chem.MolFromSequence, ionised phosphates), independent of the builder.
const reference = JSON.parse(readFileSync(new URL("./fixtures/nucleic/rdkit-references.json", import.meta.url), "utf8")).cases
  .find((item: { type: string; sequence: string; fivePrime: string; strands: string }) => item.type === "DNA" && item.sequence === "GATTACA" && item.fivePrime === "hydroxyl" && item.strands === "single");
const rdkit = await (initRDKitModule as unknown as () => Promise<{ get_mol: (text: string, details?: string) => { get_smiles: () => string; delete: () => void } | null }>)();
const smiles = (text: string) => { const mol = rdkit.get_mol(text, JSON.stringify({ removeHs: true }))!; try { return mol.get_smiles(); } finally { mol.delete(); } };

test("a built DNA strand inserts into the open SDF as a separate molecule in one Undo step", async () => {
  // The real nucleic worker, as the builder dialog runs it.
  const build = async () => (await runNucleicTask({ sequence: "GATTACA", options: { type: "DNA", form: "B", strands: "single", fivePrime: "hydroxyl" } })).graph;
  const view = await fixture("sdf", useGraphDraft, ethanol, document => <InsertBuiltStructureButton document={document} name="DNA GATTACA" build={build} />);
  try {
    const before = view.graph.history!.current, button = view.host.querySelector<HTMLButtonElement>("button")!;
    await act(async () => { button.dispatchEvent(new browser.MouseEvent("click", { bubbles: true }) as unknown as Event); });
    await view.settle(() => view.graph.history!.current !== before || Boolean(view.host.querySelector('[role="alert"]')));
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBeUndefined();
    const after = view.graph.history!.current;
    // RDKit reads the draft as ethanol plus its own sequence molecule, configurations included. RDKit
    // gives phosphorus a configuration from 3D; its free oxygens are equivalent by resonance.
    expect(smiles(smiles(after.text).replace(/\[P@@?\]/gu, "P"))).toBe(smiles(`CCO.${reference.smiles}`));
    expect(after.structure.atoms.length).toBe(9 + reference.atoms);
    expect(after.structure.atoms.slice(0, 9)).toEqual(before.structure.atoms);
    await act(async () => view.graph.undo());
    expect(view.graph.history!.current).toBe(before);
  } finally { await view.close(); }
}, 60_000);
