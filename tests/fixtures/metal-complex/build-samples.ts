// Writes samples/<id>.sdf exactly as the metal-complex worker serializes them; reference.py reads these bytes.
import { writeFileSync } from "node:fs";
import { buildMetalComplex, type MetalComplexOptions } from "../../../apps/desktop/src/lib/molecular-workbench/metal-complex";
import { sdfFromGraph } from "../../../apps/desktop/src/lib/workbench/formats";
import complexes from "./complexes.json";

for (const [id, entry] of Object.entries(complexes)) {
  const complex = buildMetalComplex(entry.options as MetalComplexOptions);
  writeFileSync(new URL(`samples/${id}.sdf`, import.meta.url), sdfFromGraph(complex.atoms, complex.bonds, complex.name, complex.coordination, complex.atoms.map(atom => atom.charge)));
}
