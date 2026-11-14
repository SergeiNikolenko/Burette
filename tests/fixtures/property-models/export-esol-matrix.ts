// Writes the table the scikit-learn reference is computed on: one row per ESOL
// molecule with Burette's structure properties, logS, the solubility class
// index and the cross-validation fold. Usage:
//   bun tests/fixtures/property-models/export-esol-matrix.ts <output.csv>
import { writeFileSync } from "node:fs";

import { MODEL_PROPERTY_IDS } from "../../../apps/desktop/src/lib/property-models/model-input";
import { ESOL_CLASSES, esolInput, solubilityClass } from "./esol";

const output = process.argv[2];
if (!output) throw new Error("Usage: export-esol-matrix.ts <output.csv>");
const { input, fold } = await esolInput();
const lines = [[...MODEL_PROPERTY_IDS, "logS", "class", "fold"].join(",")];
input.rows.forEach((_, row) => {
  const features = Array.from(input.features.subarray(row * input.featureCount, (row + 1) * input.featureCount), (value) => value.toString());
  lines.push([...features, input.target[row].toString(), ESOL_CLASSES.indexOf(solubilityClass(input.target[row])), fold[row]].join(","));
});
writeFileSync(output, `${lines.join("\n")}\n`);
console.log(`${input.rows.length} rows, ${input.featureCount} features, ${input.skippedRows} skipped`);
