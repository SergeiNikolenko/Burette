import { beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { readFileSync } from "node:fs";
import initRDKitModule, { type MainModule as RDKitModule } from "@rdkit/rdkit";
import { mount, documentFor, files, until, button, click, hold, workers } from "./properties-runtime-fixture";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/molecular-graph";
import reference from "./fixtures/optimization/rdkit-optimization-reference.json";

// Stereochemistry is read back by RDKit, independently of the OpenChemLib embedding.
const flat = readFileSync(new URL("./fixtures/automation/butan-2-ol-2d.mol", import.meta.url), "utf8");
const expected = reference.flatInputs.find(item => item.smiles === "CC[C@@H](C)O")!.smiles;
let rdkit: RDKitModule;
beforeAll(async () => { rdkit = await initRDKitModule(); });
function smiles(molblock: string) {
  const mol = rdkit.get_mol(molblock, JSON.stringify({ removeHs: true }))!;
  try { return mol.get_smiles(); } finally { mol.delete(); }
}
const row = (label: string) => [...document.querySelectorAll("dt")].find(node => node.textContent === label)?.nextElementSibling ?? null;

test("Generate 3D turns a flat MOL drawing into one undoable 3D revision with its stereocentre", async () => {
  const doc = documentFor("mol"); files.set(doc.path, flat);
  const f = await mount(doc);
  try {
    await until(() => row("3D coordinates")?.querySelector("button") && !row("3D coordinates")!.querySelector("button")!.disabled);
    await click(row("3D coordinates")!.querySelector("button")!);
    await until(() => f.controller().sessionForDocument(doc)?.dirty);
    const content = f.controller().sessionForDocument(doc)!.content, prepared = parseMolecule(content, "mol"), source = parseMolecule(flat, "mol");
    expect([prepared.atoms.length, f.dock, f.opened, f.done()]).toEqual([15, ["structure-edit"], [], 1]);
    // Source atoms keep their order and the added hydrogens follow them.
    expect(prepared.atoms.slice(0, 5).map(atom => atom.element)).toEqual(source.atoms.map(atom => atom.element));
    expect(prepared.atoms.slice(5).every(atom => atom.element === "H")).toBe(true);
    expect(prepared.atoms.some(atom => Math.abs(atom.z) > 0.1)).toBe(true);
    expect(smiles(content)).toBe(expected);
    await f.render(doc, true);
    await until(() => document.querySelector(".structure-edit-outcome"));
    expect(document.querySelector(".structure-edit-outcome")!.textContent).toMatch(/^MMFF94, BFGS -?\d+\.\d\d → -?\d+\.\d\d kcal\/mol, \d+ stepsConvergedOpen steps$/u);
    await click(button("Undo")); await until(() => f.controller().sessionForDocument(doc)?.content === flat);
    await f.render(doc);
    await until(() => row("3D coordinates"));
  } finally { await f.close(); }
}, 60_000);

test("a 3D structure offers no Generate 3D, and conformer search opens an energy-ordered SDF without touching the source", async () => {
  const doc = documentFor("sdf"), source = readFileSync(new URL("./fixtures/automation/ethanol.sdf", import.meta.url), "utf8"); files.set(doc.path, source);
  const f = await mount(doc);
  try {
    await until(() => row("Conformers")?.querySelector("button"));
    expect(row("3D coordinates")).toBeNull();
    const count = row("Conformers")!.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(count, "40");
      count.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(count.value).toBe("32");
    await click(button("Search")); await until(() => f.opened.length === 1);
    const [opened] = f.opened[0], records = opened.text.split("$$$$\n").filter(Boolean);
    expect([opened.inputExtension, f.done(), f.controller().sessionForDocument(doc)]).toEqual(["sdf", 1, null]);
    const energies = records.map(record => Number(/<MMFF94 energy \(kcal\/mol\)>\n([^\n]+)/u.exec(record)![1]));
    expect(energies).toEqual([...energies].sort((a, b) => a - b));
    records.forEach((record, index) => {
      expect(smiles(record)).toBe("CCO");
      expect(Number(/<Burette conformer>\n([^\n]+)/u.exec(record)![1])).toBe(index + 1);
      expect(Number(/<MMFF94 relative energy \(kcal\/mol\)>\n([^\n]+)/u.exec(record)![1])).toBeCloseTo(energies[index] - energies[0], 9);
    });
  } finally { await f.close(); }
}, 60_000);

test("cancelling a conformer search terminates its worker and opens nothing", async () => {
  const doc = documentFor("sdf"); files.set(doc.path, readFileSync(new URL("./fixtures/automation/n-methylacetamide.sdf", import.meta.url), "utf8"));
  const f = await mount(doc);
  try {
    await until(() => row("Conformers")?.querySelector("button")); hold("conformers");
    await click(button("Search")); await until(() => workers.at(-1)?.action === "conformers");
    const search = workers.at(-1)!; await click(button("Cancel"));
    expect(search.terminated).toBe(true);
    await act(async () => { search.replies.shift()?.(); });
    expect([f.opened, f.done()]).toEqual([[], 0]);
  } finally { await f.close(); }
}, 60_000);
