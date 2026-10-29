import { expect, test } from "bun:test";
import React from "react";
import { mount, button, click, input } from "./structure-controls-dom";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import { readGraphMetadata, patchGraphMetadata, type GraphMetadataPatch } from "../apps/desktop/src/lib/workbench/graph-metadata";
import type { GraphSnapshot } from "../apps/desktop/src/lib/workbench/use-graph-draft";
const { GraphMetadataFields } = await import("../apps/desktop/src/components/workbench/graph-metadata-fields");
const molecule = parseMolecule("2\nmetadata\nC 0 0 0\nO 1.4 0 0\n", "xyz");
const snapshot: GraphSnapshot = { structure: { ...molecule, sourceAtomIndices: [0, 1] }, annotations: [], text: "", outcome: null, metadata: readGraphMetadata("", 2) };

test("metadata fields submit the full stable-identity patch and reset on a new selection key", async () => {
  const patches: GraphMetadataPatch[] = [];
  const view = await mount(<GraphMetadataFields key="first" snapshot={snapshot} atomIndex={0} disabled={false} onApply={patch => patches.push(patch)} />);
  try {
    expect(button(view.host, "Apply metadata").disabled).toBe(true);
    for (const [label, value] of [["Conformer label", "Final geometry"], ["Atom name", "CA"], ["Residue name", "GLY"], ["Residue sequence", "-12"], ["Chain", "A"], ["Insertion code", "B"]]) await input(view.host, label, value);
    await click(button(view.host, "Apply metadata"));
    expect(patches).toEqual([{ conformerLabel: "Final geometry", atoms: [{ id: snapshot.metadata!.atoms[0].id, atomName: "CA", residue: { name: "GLY", sequence: -12, chain: "A", insertionCode: "B" } }] }]);
    const next = { ...snapshot, metadata: patchGraphMetadata(snapshot.metadata!, patches[0]) };
    await view.render(<GraphMetadataFields key="committed" snapshot={next} atomIndex={0} disabled={false} onApply={patch => patches.push(patch)} />);
    await click(button(view.host, "Clear residue"));
    await click(button(view.host, "Apply metadata"));
    expect(patches[1]).toEqual({ atoms: [{ id: snapshot.metadata!.atoms[0].id, residue: null }] });
    await input(view.host, "Atom name", "UNSAVED");
    await view.render(<GraphMetadataFields key="second-atom" snapshot={next} atomIndex={1} disabled={false} onApply={patch => patches.push(patch)} />);
    expect(view.host.querySelector<HTMLInputElement>('[aria-label="Atom name"]')!.value).toBe("");
    expect(view.host.querySelector<HTMLInputElement>('[aria-label="Conformer label"]')!.value).toBe("Final geometry");
  } finally { await view.close(); }
});

test("invalid residues and control characters never submit, and disabled metadata cannot be applied", async () => {
  const patches: GraphMetadataPatch[] = [];
  const view = await mount(<GraphMetadataFields snapshot={snapshot} atomIndex={0} disabled={false} onApply={patch => patches.push(patch)} />);
  try {
    await input(view.host, "Residue name", "GLY"); await input(view.host, "Residue sequence", "1000000");
    await click(button(view.host, "Apply metadata"));
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("integer sequence"); expect(patches).toEqual([]);
    await input(view.host, "Residue sequence", "1"); await input(view.host, "Chain", "A\u200B");
    await click(button(view.host, "Apply metadata"));
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("control characters"); expect(patches).toEqual([]);
    await view.render(<GraphMetadataFields key="disabled" snapshot={snapshot} atomIndex={null} disabled onApply={patch => patches.push(patch)} />);
    expect([...view.host.querySelectorAll<HTMLInputElement>("input")].every(node => node.disabled)).toBe(true);
    expect(button(view.host, "Apply metadata").disabled).toBe(true);
    expect(view.host.querySelector('[aria-label="Atom name"]')).toBeNull();
  } finally { await view.close(); }
});
