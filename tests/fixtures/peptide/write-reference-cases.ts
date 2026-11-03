// Writes the peptide reference cases for measure-reference.py:
//   bun tests/fixtures/peptide/write-reference-cases.ts <directory>
// D chains take the mirrored preset angles, as the builder dialog sends them.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildPeptideGeometry, type PeptideGeometryOptions } from "../../../apps/desktop/src/lib/molecular-workbench/peptide-geometry";
import { peptideMmcif } from "../../../apps/desktop/src/lib/molecular-workbench/peptide-mmcif";
import cases from "./reference-cases.json";

const require = createRequire(import.meta.url);
const { CIF } = require("@molstar/io/reader/cif");
const { trajectoryFromMmCIF } = require("@molstar/model/formats/structure/mmcif");
const { Structure } = require("@molstar/model/model/structure");
const { to_mmCIF } = require("@molstar/model/model/structure/export/mmcif");

const mirror = (angle: number) => angle === 180 ? 180 : -angle;
type Case = { id: string; sequence: string; options: PeptideGeometryOptions; preset?: string };

export const referenceCases: Case[] = [
  ...Object.entries(cases.presets).flatMap(([preset, { phi, psi }]) => cases.matrix.flatMap(({ sequence, chirality }) => chirality.map(stereo => ({
    id: `${preset}-${sequence}-${stereo}`, preset, sequence: cases.sequences[sequence as keyof typeof cases.sequences],
    options: { ...cases.matrixTermini, chirality: stereo, phi: stereo === "D" ? mirror(phi) : phi, psi: stereo === "D" ? mirror(psi) : psi } as PeptideGeometryOptions,
  })))),
  ...cases.mirroredSideChains.sequences.map(sequence => {
    const { preset } = cases.mirroredSideChains, { phi, psi } = cases.presets[preset as keyof typeof cases.presets];
    return { id: `${preset}-${sequence}-D`, preset, sequence: cases.sequences[sequence as keyof typeof cases.sequences], options: { ...cases.matrixTermini, chirality: "D", phi: mirror(phi), psi: mirror(psi) } as PeptideGeometryOptions };
  }),
  ...cases.extra.map(({ id, sequence, options }) => ({ id, sequence, options: options as PeptideGeometryOptions })),
];

/** Builder mmCIF per case, plus Mol*'s full-structure re-export of the listed cases (the viewer's Save as mmCIF). */
export async function referenceCaseTexts() {
  const texts = new Map(referenceCases.map(item => [item.id, peptideMmcif(buildPeptideGeometry(item.sequence, item.options))]));
  for (const id of cases.molstarReexport) {
    const parsed = await CIF.parse(texts.get(id)!).run();
    const structure = Structure.ofModel((await trajectoryFromMmCIF(parsed.result.blocks[0]).run()).representative);
    texts.set(`${id}.molstar`, to_mmCIF("peptide", structure, false, { copyAllCategories: true }));
  }
  return texts;
}

if (import.meta.main) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: bun tests/fixtures/peptide/write-reference-cases.ts <directory>");
  mkdirSync(directory, { recursive: true });
  for (const [id, text] of await referenceCaseTexts()) writeFileSync(`${directory}/${id}.cif`, text);
}
