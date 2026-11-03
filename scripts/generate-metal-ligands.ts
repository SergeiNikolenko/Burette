// Regenerates apps/desktop/src/lib/molecular-workbench/metal-ligands.json from an OpenChemistry/fragments checkout:
//   git -C <fragments> checkout 7d842f435aec4729a308b23ad7f9501bdd44aa02
//   bun scripts/generate-metal-ligands.ts <fragments> > apps/desktop/src/lib/molecular-workbench/metal-ligands.json
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = process.argv[2];
if (!root) throw new Error("Pass the OpenChemistry/fragments checkout directory.");
const commit = "7d842f435aec4729a308b23ad7f9501bdd44aa02";
const symbols: Record<number, string> = { 1: "H", 6: "C", 7: "N", 8: "O", 9: "F", 15: "P", 17: "Cl", 35: "Br", 53: "I" };
type Spec = { id: string; file: string; label: string; formula: string; charges?: Record<number, number>; drop?: number[] };
const specs: Spec[] = [
  { id: "aqua", file: "ligands/monodentate/aqua.cjson", label: "H₂O (aqua)", formula: "H2O" },
  { id: "hydroxido", file: "ligands/monodentate/aqua.cjson", label: "OH⁻ (hydroxido)", formula: "OH", charges: { 1: -1 }, drop: [3] },
  { id: "ammine", file: "ligands/monodentate/ammine.cjson", label: "NH₃ (ammine)", formula: "NH3" },
  { id: "fluorido", file: "ligands/monodentate/fluorido.cjson", label: "F⁻ (fluorido)", formula: "F" },
  { id: "chlorido", file: "ligands/monodentate/chlorido.cjson", label: "Cl⁻ (chlorido)", formula: "Cl" },
  { id: "bromido", file: "ligands/monodentate/bromido.cjson", label: "Br⁻ (bromido)", formula: "Br" },
  { id: "iodido", file: "ligands/monodentate/iodido.cjson", label: "I⁻ (iodido)", formula: "I" },
  { id: "cyanido", file: "ligands/monodentate/cyano.cjson", label: "CN⁻ (cyanido)", formula: "CN", charges: { 1: -1 } },
  { id: "carbonyl", file: "ligands/monodentate/carbonyl.cjson", label: "CO (carbonyl)", formula: "CO", charges: { 1: -1, 2: 1 } },
  { id: "phosphane", file: "ligands/monodentate/phosphine.cjson", label: "PH₃ (phosphane)", formula: "PH3" },
  { id: "trimethylphosphane", file: "ligands/monodentate/trimethylphosphine.cjson", label: "PMe₃ (trimethylphosphane)", formula: "PMe3" },
  { id: "pyridine", file: "ligands/monodentate/pyridyl.cjson", label: "py (pyridine)", formula: "py" },
  { id: "ethylenediamine", file: "ligands/bidentate/en-ethylenediamine.cjson", label: "en (ethylenediamine)", formula: "en" },
  { id: "bipyridine", file: "ligands/bidentate/bpy-bipyridine.cjson", label: "bpy (2,2′-bipyridine)", formula: "bpy" },
  { id: "phenanthroline", file: "ligands/bidentate/phenanthroline.cjson", label: "phen (1,10-phenanthroline)", formula: "phen" },
  { id: "oxalato", file: "ligands/bidentate/oxalate.cjson", label: "ox²⁻ (oxalato)", formula: "ox" },
  { id: "acetylacetonato", file: "ligands/bidentate/acac-acetylacetonate.cjson", label: "acac⁻ (acetylacetonato)", formula: "acac", charges: { 2: -1 } },
];
const ligands: Record<string, unknown> = {};
for (const spec of specs) {
  const cjson = JSON.parse(readFileSync(`${root}/${spec.file}`, "utf8"));
  const numbers: number[] = cjson.atoms.elements.number, coords: number[] = cjson.atoms.coords["3d"], index: number[] = cjson.bonds.connections.index, orders: number[] = cjson.bonds.order;
  const charges = numbers.map((_, i) => spec.charges?.[i] ?? cjson.atoms.formalCharges?.[i] ?? 0);
  const dummy = numbers.indexOf(0);
  if (numbers.lastIndexOf(0) !== dummy) throw new Error(`${spec.file}: one attachment dummy expected`);
  const kept = numbers.map((_, i) => i).filter(i => i !== dummy && !spec.drop?.includes(i));
  const map = new Map(kept.map((old, next) => [old, next]));
  const donors: number[] = [], bonds: number[][] = [];
  orders.forEach((order, b) => {
    const [a, c] = [index[2 * b], index[2 * b + 1]];
    if (a === dummy || c === dummy) { donors.push(map.get(a === dummy ? c : a)!); return; }
    if (map.has(a) && map.has(c)) bonds.push([map.get(a)!, map.get(c)!, order]);
  });
  const round = (v: number) => Number(v.toFixed(4));
  ligands[spec.id] = { label: spec.label, formula: spec.formula, file: spec.file, sha256: createHash("sha256").update(readFileSync(`${root}/${spec.file}`)).digest("hex"), ...(spec.drop ? { derived: "aqua.cjson with one H removed" } : {}),
    metal: [0, 1, 2].map(a => round(coords[3 * dummy + a])), donors: donors.sort((a, b) => a - b),
    atoms: kept.map(i => [symbols[numbers[i]], round(coords[3 * i]), round(coords[3 * i + 1]), round(coords[3 * i + 2]), charges[i]]), bonds };
}
const out = { source: { repository: "https://github.com/OpenChemistry/fragments", commit, license: "BSD-3-Clause",
  note: "Coordinates and covalent bonds copied from the listed CJSON files; the attachment dummy atom is stored as `metal`; formal charges follow the dative (ionic) ligand model." }, ligands };
// Numeric tuples stay on one line.
const text = JSON.stringify(out, null, 2).replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (_, body) => `[${body.replace(/\s+/g, " ")}]`);
process.stdout.write(text + "\n");
