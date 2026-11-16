import type { WorkbenchCrystalTransform } from "../../../../../scripts/workbench-agent-contract.mjs";
import type { CrystalEdit } from "../molecular-workbench/crystal-edit";
import { SYMMETRY_ATOM_LIMIT } from "../molecular-workbench/crystal-symmetry";
import { MAX_POINT_GROUP_ATOMS } from "../molecular-workbench/symmetry/point-group";
import { runSymmetryTask } from "../molecular-workbench/symmetry/symmetry-client";
import type { UnitCell } from "../molecular-workbench/types";
import { broadenPattern, powderPatternCsv, powderPatternJson, XRD_LIMITS, XRD_RADIATION } from "../molecular-workbench/xrd/powder-xrd";
import { XRD_ENGINE } from "../molecular-workbench/xrd/xrd-engine";
import { serializeXyz } from "../molecular-workbench/xyz";
import { runCrystalTask } from "./crystal-task";
import { operationClasses, pointGroupAtoms } from "./molecular-symmetry";
import { runPowderXrdTask } from "./xrd-task";
import type { AgentJobRunner } from "./agent-jobs";
import type { Snapshot } from "./agent-source";

/** Rows of a summary that an agent response carries; the full lists are artifacts. */
const SUMMARY_ROWS = 50;

/** Why a molecule-only point-group job cannot run, or null. */
function moleculeUnavailable(snapshot: Snapshot) {
  if (snapshot.crystal || snapshot.crystalError) return "This source has a unit cell; use space_group.";
  if (!snapshot.structure) return snapshot.structureError ?? snapshot.sourceError ?? "The atoms could not be read.";
  return snapshot.structure.atoms.length > MAX_POINT_GROUP_ATOMS ? `Point groups are found for up to ${MAX_POINT_GROUP_ATOMS} atoms.` : null;
}

/** Why a job on the full periodic cell cannot run, or null. */
function crystalUnavailable(kind: string, atomLimit: number) {
  return (snapshot: Snapshot) => {
    if (!snapshot.crystal) return snapshot.crystalError ?? "This source has no unit cell (open a small-molecule CIF, a POSCAR or an extended XYZ with a Lattice).";
    return snapshot.crystal.atoms.length > atomLimit ? `${kind} supports at most ${atomLimit.toLocaleString("en-US")} atoms in the cell.` : null;
  };
}

function crystalEdit(params: WorkbenchCrystalTransform): CrystalEdit {
  switch (params.operation) {
    case "set_cell": return { kind: "set-cell", cell: params.cell as UnitCell, policy: params.keep };
    case "wrap": return { kind: "wrap" };
    case "standard_orientation": return { kind: "standard-orientation" };
    case "niggli": return { kind: "niggli" };
    case "scale_volume": return { kind: "scale-volume", volume: params.volumeCubicAngstrom };
    case "supercell": return { kind: "supercell", repeats: params.repeats };
    case "primitive": case "conventional": case "symmetrize": return { kind: params.operation, tolerance: params.toleranceAngstrom };
    case "asymmetric_unit": return { kind: "asymmetric-unit", tolerance: params.toleranceAngstrom };
    case "fill": return { kind: "fill", hallNumber: params.hallNumber };
  }
}
const MIME = { cif: "chemical/x-cif", xyz: "chemical/x-xyz", vasp: "text/plain" } as const;
const EXTENSION = { cif: "cif", xyz: "xyz", vasp: "vasp" } as const;

/** Point group and symmetrized coordinates of a molecule, in chemical-graph atom order. */
export const pointGroupJob: AgentJobRunner<"point_group"> = {
  unavailable: moleculeUnavailable,
  async run(input, params, { signal, timeoutMs, stem, artifact }) {
    const atoms = pointGroupAtoms(input.structure!.atoms);
    const result = await runSymmetryTask({ action: "symmetrize", input: { atoms, tolerance: params.tolerance } }, { signal, timeoutMs });
    const xyz = serializeXyz(atoms.map((atom, index) => { const [x, y, z] = result.coordinates[index]; return { element: atom.element, x, y, z }; }),
      `${stem} symmetrized to ${result.pointGroup}`);
    return {
      summary: {
        pointGroup: result.pointGroup, order: result.order, tolerance: result.tolerance, operationCount: result.operations.length,
        classes: operationClasses(result.operations, result.pointGroup).map(({ count, symbol }) => ({ count, operation: `${symbol.base}${symbol.sub}${symbol.sup ? `^${symbol.sup}` : ""}${symbol.prime}` })),
        equivalenceSets: result.equivalenceSets.slice(0, SUMMARY_ROWS).map((set) => set.atoms), equivalenceSetCount: result.equivalenceSets.length,
        maxDisplacementAngstrom: result.maxDisplacement, rmsDisplacementAngstrom: result.rmsDisplacement, atomOrder: "chemical graph",
      },
      artifacts: [await artifact("symmetrized", `${stem}-symmetrized.xyz`, "chemical/x-xyz", xyz)],
    };
  },
};

export const spaceGroupJob: AgentJobRunner<"space_group"> = {
  unavailable: crystalUnavailable("space_group", SYMMETRY_ATOM_LIMIT),
  async run(input, params, { signal, timeoutMs }) {
    const result = await runCrystalTask({ action: "analyze", source: input.crystalSource!, tolerance: params.toleranceAngstrom }, { signal, timeoutMs });
    return { summary: { ...result, sites: result.sites.slice(0, SUMMARY_ROWS) }, artifacts: [] };
  },
};

export const powderXrdJob: AgentJobRunner<"powder_xrd"> = {
  unavailable: crystalUnavailable("powder_xrd", XRD_LIMITS.atoms),
  async run(input, params, { signal, timeoutMs, stem, artifact }) {
    const crystal = input.crystal!;
    const { wavelengthAngstrom: wavelength, twoThetaMinDegrees: twoThetaMin, twoThetaMaxDegrees: twoThetaMax } = params;
    const pattern = await runPowderXrdTask({ atoms: crystal.atoms, cell: crystal.cell, wavelength, twoThetaMin, twoThetaMax }, { signal, timeoutMs });
    const radiation = XRD_RADIATION.find((item) => item.wavelength === wavelength)?.label ?? "Custom wavelength";
    const profile = params.profile ? broadenPattern(pattern, params.profile, params.fwhmDegrees!) : null;
    const context = { title: input.document.title, radiation, profile, engine: XRD_ENGINE };
    const strongest = [...pattern.peaks].sort((a, b) => b.relativeIntensity - a.relativeIntensity).slice(0, SUMMARY_ROWS);
    return {
      summary: { wavelengthAngstrom: wavelength, twoThetaMinDegrees: twoThetaMin, twoThetaMaxDegrees: twoThetaMax,
        ...(profile ? { profile: profile.shape, fwhmDegrees: profile.fwhm, profilePoints: profile.twoTheta.length } : {}), peakCount: pattern.peaks.length, absentReflections: pattern.absentReflections,
        strongestPeaks: strongest.map(({ twoTheta, d, relativeIntensity, multiplicity, hkl }) => ({ twoTheta, d, relativeIntensity, multiplicity, hkl })) },
      artifacts: [
        await artifact("peaks", `${stem}-xrd.csv`, "text/csv", powderPatternCsv(pattern, context)),
        await artifact("pattern", `${stem}-xrd.json`, "application/json", powderPatternJson(pattern, context)),
      ],
    };
  },
};

/** The Crystal panel's edits; the edited source is an artifact in the source's format (CIF for an asymmetric unit). */
export const crystalTransformJob: AgentJobRunner<"crystal_transform"> = {
  unavailable: crystalUnavailable("crystal_transform", Number.POSITIVE_INFINITY),
  async run(input, params, { signal, timeoutMs, stem, artifact }) {
    const result = await runCrystalTask({ action: "edit", source: input.crystalSource!, edit: crystalEdit(params) }, { signal, timeoutMs });
    const format = result.newDocument ? "cif" : result.format;
    return {
      summary: { operation: params.operation, format, atomCount: result.atomCount, parameters: result.parameters, volumeCubicAngstrom: result.volume, spaceGroup: result.spaceGroup,
        niggliTransform: result.niggliTransform, addedAtoms: result.addedAtoms },
      artifacts: [await artifact("structure", `${stem}-${params.operation.replace(/_/gu, "-")}.${EXTENSION[format]}`, MIME[format], result.text)],
    };
  },
};
