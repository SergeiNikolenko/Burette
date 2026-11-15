import { readFileSync } from "node:fs";

// Reuse independently pinned, fixed-coordinate repository references; no new numeric oracle.
const reference = JSON.parse(readFileSync(new URL("./forcefield/rdkit-reference.json", import.meta.url), "utf8"));
export const amideReference = reference.records.find((record: { smiles: string }) => record.smiles === "CC(=O)NC");
export const waterReference = JSON.parse(readFileSync(new URL("../../compute/rdkit-conformer/fixtures/uff-rdkit-2025.03.4.json", import.meta.url), "utf8")).cases.find((record: { name: string }) => record.name === "water");
const waterLines: string[] = waterReference.molblock.split("\n");
for (let atom = 0; atom < 3; atom++) waterLines[atom + 4] = waterReference.coordinates.slice(3 * atom, 3 * atom + 3).map((value: number) => value.toFixed(4).padStart(10)).join("") + waterLines[atom + 4].slice(30);
// Authored saturated H/O/H inputs frozen before the port; exact row order is intentional.
export const energyCases = [
  { name: "energy-amide", extension: "mol", source: amideReference.molfile },
  { name: "energy-water-fixed", extension: "mol", source: waterLines.join("\n") },
  { name: "energy-water-h-first", extension: "xyz", source: "3\nExisting H/O/H force fixture\nH 0.95 0.0 0.0\nO 0.0 0.0 0.0\nH -0.23 0.93 0.0\n" },
  { name: "energy-water-permuted", extension: "xyz", source: "3\nSource row permutation [1,2,0]\nO 0.0 0.0 0.0\nH -0.23 0.93 0.0\nH 0.95 0.0 0.0\n" },
  { name: "energy-water-rigid", extension: "xyz", source: "3\nRz90 plus translation\nH 4.0 -2.05 2.0\nO 4.0 -3.0 2.0\nH 3.07 -3.23 2.0\n" },
];
