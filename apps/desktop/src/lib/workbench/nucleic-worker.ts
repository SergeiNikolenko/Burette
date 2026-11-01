import { buildNucleicAcid, nucleicAcidFileStem, nucleicAcidMmcif } from "../molecular-workbench/nucleic";
import type { NucleicBuildRequest, NucleicBuildResult } from "./nucleic-task";

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<NucleicBuildRequest>) => void; postMessage: (message: unknown) => void };
scope.onmessage = ({ data }) => {
  try {
    const model = buildNucleicAcid(data.sequence, data.options);
    const sequence = model.strands[0].sequence, name = nucleicAcidFileStem(sequence, model.options);
    const result: NucleicBuildResult = {
      text: nucleicAcidMmcif(model, name), format: "mmcif", name, sequence, atomCount: model.atoms.length,
      residueCount: model.strands.length * sequence.length, charge: model.charge, strands: model.strands,
      graph: {
        atoms: model.atoms.map(({ element, x, y, z, charge }) => ({ element, x, y, z, charge })),
        bonds: model.bonds.map(({ a, b, order }) => ({ a, b, order: order as 1 | 2 })),
      },
    };
    scope.postMessage({ ok: true, result });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "Could not build the nucleic acid." });
  }
};
