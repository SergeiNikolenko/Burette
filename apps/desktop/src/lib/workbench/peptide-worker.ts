import residueData from "../molecular-workbench/peptide-residues.json";
import { buildPeptideGeometry } from "../molecular-workbench/peptide-geometry";
import { peptideMmcif } from "../molecular-workbench/peptide-mmcif";
import type { PeptideBuildRequest, PeptideBuildResult } from "./peptide-task";

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<PeptideBuildRequest>) => void; postMessage: (message: unknown) => void };
const oneLetter = new Map(Object.entries(residueData).map(([code, residue]) => [residue.name, code]));
scope.onmessage = ({ data }) => {
  try {
    const sequence = data.codes === "three"
      ? data.sequence.trim().toUpperCase().split(/[\s-]+/).map(code => {
        const one = oneLetter.get(code);
        if (!one) throw new Error("Use standard three-letter amino-acid codes separated by spaces or hyphens.");
        return one;
      }).join("")
      : data.sequence.replace(/\s+/g, "").toUpperCase();
    const model = buildPeptideGeometry(sequence, data.options);
    const result: PeptideBuildResult = { cif: peptideMmcif(model), sequence, atomCount: model.atoms.length,
      residueCount: model.chirality.length, charge: model.atoms.reduce((total, atom) => total + atom.charge, 0) };
    scope.postMessage({ ok: true, result });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "Could not build the peptide." });
  }
};
