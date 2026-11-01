import type { WorkbenchCrystalTransform, WorkbenchJobRequest } from "../../../../../scripts/workbench-agent-contract.mjs";
import type { CrystalEdit } from "../molecular-workbench/crystal-edit";
import { SYMMETRY_ATOM_LIMIT } from "../molecular-workbench/crystal-symmetry";
import { PAIR_DISTRIBUTION_LIMITS, pairDistributionCsv, pairDistributionJson, selectPairs } from "../molecular-workbench/pair-distribution/pair-distribution";
import { runPairDistributionTask } from "../molecular-workbench/pair-distribution/pair-distribution-client";
import { MAX_POINT_GROUP_ATOMS } from "../molecular-workbench/symmetry/point-group";
import { runSymmetryTask } from "../molecular-workbench/symmetry/symmetry-client";
import type { UnitCell } from "../molecular-workbench/types";
import { powderPatternCsv, powderPatternJson, XRD_LIMITS, XRD_RADIATION } from "../molecular-workbench/xrd/powder-xrd";
import { XRD_ENGINE } from "../molecular-workbench/xrd/xrd-engine";
import { serializeXyz } from "../molecular-workbench/xyz";
import { runCrystalTask } from "./crystal-task";
import { fileStem } from "./formats";
import { operationClasses, pointGroupAtoms } from "./molecular-symmetry";
import { runPowderXrdTask } from "./xrd-task";
import type { Snapshot } from "./agent-source";

/** Agent jobs of the Crystal and Symmetry panels; each returns a summary and named artifacts. */
export type CrystalJobKind = "point_group" | "space_group" | "powder_xrd" | "pair_distribution" | "crystal_transform";
export const CRYSTAL_JOB_KINDS: readonly CrystalJobKind[] = ["point_group", "space_group", "powder_xrd", "pair_distribution", "crystal_transform"];
type CrystalJob = Extract<WorkbenchJobRequest, { kind: CrystalJobKind }>;
type ArtifactWriter<Artifact> = (name: string, fileName: string, mimeType: string, content: string) => Promise<Artifact>;

/** Rows of a summary that an agent response carries; the full lists are artifacts. */
const SUMMARY_ROWS = 50;
const PAIR_DISTRIBUTION_ENGINE = "Burette periodic radial distribution 1";

const ATOM_LIMITS: Record<Exclude<CrystalJobKind, "point_group">, number> = {
  space_group: SYMMETRY_ATOM_LIMIT, powder_xrd: XRD_LIMITS.atoms, pair_distribution: PAIR_DISTRIBUTION_LIMITS.atoms, crystal_transform: Number.POSITIVE_INFINITY,
};

export function crystalJobUnavailable(snapshot: Snapshot, kind: CrystalJobKind): string | null {
  if (kind === "point_group") {
    if (snapshot.crystal || snapshot.crystalError) return "This source has a unit cell; use space_group.";
    if (!snapshot.structure) return snapshot.structureError ?? snapshot.sourceError ?? "The atoms could not be read.";
    return snapshot.structure.atoms.length > MAX_POINT_GROUP_ATOMS ? `Point groups are found for up to ${MAX_POINT_GROUP_ATOMS} atoms.` : null;
  }
  if (!snapshot.crystal) return snapshot.crystalError ?? "This source has no unit cell (open a small-molecule CIF, a POSCAR or an extended XYZ with a Lattice).";
  return snapshot.crystal.atoms.length > ATOM_LIMITS[kind] ? `${kind} supports at most ${ATOM_LIMITS[kind].toLocaleString("en-US")} atoms in the cell.` : null;
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

/** Runs one crystal or symmetry job on the snapshot it was submitted with. */
export async function runCrystalJob<Artifact>(request: CrystalJob, input: Snapshot, options: { signal: AbortSignal; timeoutMs: number }, artifact: ArtifactWriter<Artifact>) {
  const stem = fileStem(input.document.title);
  if (request.kind === "point_group") {
    const atoms = pointGroupAtoms(input.structure!.atoms);
    const result = await runSymmetryTask({ action: "symmetrize", input: { atoms, tolerance: request.params.tolerance } }, options);
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
  }
  const crystal = input.crystal!, source = input.crystalSource!;
  if (request.kind === "space_group") {
    const result = await runCrystalTask({ action: "analyze", source, tolerance: request.params.toleranceAngstrom }, options);
    return { summary: { ...result, sites: result.sites.slice(0, SUMMARY_ROWS) }, artifacts: [] };
  }
  if (request.kind === "powder_xrd") {
    const { wavelengthAngstrom: wavelength, twoThetaMinDegrees: twoThetaMin, twoThetaMaxDegrees: twoThetaMax } = request.params;
    const pattern = await runPowderXrdTask({ atoms: crystal.atoms, cell: crystal.cell, wavelength, twoThetaMin, twoThetaMax }, options);
    const radiation = XRD_RADIATION.find((item) => item.wavelength === wavelength)?.label ?? "Custom wavelength";
    const context = { title: input.document.title, radiation, profile: null, engine: XRD_ENGINE };
    const strongest = [...pattern.peaks].sort((a, b) => b.relativeIntensity - a.relativeIntensity).slice(0, SUMMARY_ROWS);
    return {
      summary: { wavelengthAngstrom: wavelength, twoThetaMinDegrees: twoThetaMin, twoThetaMaxDegrees: twoThetaMax, peakCount: pattern.peaks.length, absentReflections: pattern.absentReflections,
        strongestPeaks: strongest.map(({ twoTheta, d, relativeIntensity, multiplicity, hkl }) => ({ twoTheta, d, relativeIntensity, multiplicity, hkl })) },
      artifacts: [
        await artifact("peaks", `${stem}-xrd.csv`, "text/csv", powderPatternCsv(pattern, context)),
        await artifact("pattern", `${stem}-xrd.json`, "application/json", powderPatternJson(pattern, context)),
      ],
    };
  }
  if (request.kind === "pair_distribution") {
    const result = await runPairDistributionTask({ atoms: crystal.atoms, cell: crystal.cell, rMax: request.params.rMaxAngstrom, binWidth: request.params.binWidthAngstrom }, options);
    const all = selectPairs(result, null, null), context = { title: input.document.title, engine: PAIR_DISTRIBUTION_ENGINE };
    const kinds = result.species.length;
    return {
      summary: { rMaxAngstrom: result.rMax, binWidthAngstrom: result.binWidth, bins: result.bins, volumeCubicAngstrom: result.volume, atomCount: result.atomCount, pairs: result.pairs,
        species: result.species.map((symbol, index) => ({ symbol, count: result.speciesCounts[index] })),
        nearest: result.species.flatMap((centre, a) => result.species.map((neighbour, b) => ({ centre, neighbour,
          distanceAngstrom: Number.isFinite(result.minDistance[a * kinds + b]) ? result.minDistance[a * kinds + b] : null }))).slice(0, SUMMARY_ROWS) },
      artifacts: [
        await artifact("histogram", `${stem}-pair-distribution.json`, "application/json", pairDistributionJson(result, all, context)),
        await artifact("g_r", `${stem}-gr.csv`, "text/csv", pairDistributionCsv(result, all, context)),
      ],
    };
  }
  const operation = request.params.operation;
  const result = await runCrystalTask({ action: "edit", source, edit: crystalEdit(request.params) }, options);
  const format = result.newDocument ? "cif" : result.format;
  return {
    summary: { operation, format, atomCount: result.atomCount, parameters: result.parameters, volumeCubicAngstrom: result.volume, spaceGroup: result.spaceGroup,
      niggliTransform: result.niggliTransform, addedAtoms: result.addedAtoms },
    artifacts: [await artifact("structure", `${stem}-${operation.replace(/_/gu, "-")}.${EXTENSION[format]}`, MIME[format], result.text)],
  };
}
