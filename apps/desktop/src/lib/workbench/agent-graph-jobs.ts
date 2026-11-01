import { WORKBENCH_LIMITS, type WorkbenchJobParams } from "../../../../../scripts/workbench-agent-contract.mjs";
import { runChemistryTask } from "../molecular-workbench/compute-client";
import { runGraphTask } from "../molecular-workbench/graph-compute-client";
import type { MolecularStructure } from "../molecular-workbench/molecular-graph";
import type { EnergyForces } from "../molecular-workbench/energy-forces";
import { flatDepiction, optimizationUnavailable, resolveConstraints, type OptimizationResult } from "../molecular-workbench/optimization";
import type { MolecularAtom } from "../molecular-workbench/types";
import { serializeXyz } from "../molecular-workbench/xyz";
import { graphDraftText } from "./graph-draft";
import { hasGraphMetadata, readGraphMetadata, remapGraphMetadata } from "./graph-metadata";
import { conformerSdfRecord, multiFrameXyz, sdfFromGraph } from "./formats";
import { sdfRecords, type Snapshot } from "./agent-source";
import type { AgentJobContext, AgentJobRunner } from "./agent-jobs";

const NUMERICAL_ATOMS = 64;
const label = (forceField: string) => forceField === "UFF" ? "UFF (RDKit)" : `${forceField} (OpenChemLib)`;

function graphUnavailable(snapshot: Snapshot): string | null {
  if (!snapshot.structure) return snapshot.structureError ?? snapshot.sourceError ?? "The chemical graph could not be read.";
  return snapshot.structure.graphComplete ? null : "This source has no complete bond orders or charges. Open an SDF or MOL version of the structure.";
}

/**
 * A result graph as SDF in source atom order. Explicit graphs keep the source record's
 * title, data items and atom identities (appended atoms get new identities); perceived
 * XYZ graphs are written from their perceived bonds.
 */
async function structureSdf(input: Snapshot, molecule: MolecularStructure, signal: AbortSignal) {
  const source = input.structure!;
  if (source.graphSource !== "explicit") return sdfFromGraph(molecule.atoms, molecule.bonds, input.document.title);
  const normalized = await runGraphTask({ action: "edit-graph", molecule, edits: [{ kind: "reorder-atoms", order: molecule.atoms.map((_, index) => index) }] }, { signal });
  const data = input.text.replace(/\r\n?/gu, "\n").split(/^M {2}END[^\n]*$/mu)[1] ?? "";
  const metadata = input.extension !== "mol" && hasGraphMetadata(data)
    ? remapGraphMetadata(readGraphMetadata(data, source.atoms.length), molecule.atoms.map((_, index) => index < source.atoms.length ? index : -1))
    : null;
  return graphDraftText(input.text, "sdf", normalized.molfile, metadata);
}

export function optimizationSummary(result: OptimizationResult) {
  return {
    method: result.method, forceField: result.forceField, model: label(result.forceField), gradient: result.gradient,
    initialEnergy: result.initialEnergy, energy: result.energy, unit: result.unit, converged: result.converged, stopReason: result.stopReason,
    iterations: result.iterations, maxGradient: result.maxGradient, gradientUnit: "kcal/(mol·Å)", frameSampling: result.frameSampling,
    frameCount: result.frames.length, frozenAtoms: result.frozenAtoms, constraintResiduals: result.constraintResiduals,
  };
}

/** The optimized SDF text and XYZ, plus the step trajectory with per-frame energies when steps exist. */
export async function optimizationArtifacts(sdf: string, result: OptimizationResult, name: string, { artifact }: Pick<AgentJobContext, "artifact">) {
  const artifacts = [
    await artifact("structure", `${name}.sdf`, "chemical/x-mdl-sdfile", sdf),
    await artifact("xyz", `${name}.xyz`, "chemical/x-xyz", serializeXyz(result.molecule.atoms, `Energy=${result.energy} kcal/mol ${result.forceField} ${result.method}`)),
  ];
  if (result.frameSampling === "steps") {
    artifacts.push(await artifact("trajectory", `${name}-steps.xyz`, "chemical/x-xyz",
      multiFrameXyz(result.frames.map((frame, index) => ({ atoms: frame.atoms, comment: `Step ${index} Energy=${frame.energy} kcal/mol` })))));
  }
  return artifacts;
}

type BatchSource = { kind: "sdf-records" | "frames"; count: number };
function batchSource(snapshot: Snapshot): BatchSource | null {
  if (snapshot.extension === "sdf" || snapshot.extension === "sd") return snapshot.sdfRecords ? { kind: "sdf-records", count: snapshot.sdfRecords } : null;
  if (!snapshot.structure) return null;
  return { kind: "frames", count: Math.max(1, snapshot.scientific?.frames.length ?? 0) };
}

/** Atoms per frame; for SDF records, from the first record's counts line (V2000 or V3000). The worker re-validates. */
function batchAtoms(snapshot: Snapshot, batch: BatchSource) {
  if (batch.kind === "frames") return snapshot.structure!.atoms.length;
  const record = snapshot.text.slice(0, 64 * 1024), v3000 = /^M {2}V30 COUNTS (\d+)/mu.exec(record);
  return Number(v3000?.[1] ?? record.replace(/\r\n?/gu, "\n").split("\n")[3]?.slice(0, 3)) || 1;
}

function forcesExtendedXyz(frames: { atoms: MolecularAtom[]; energy: number; forces: EnergyForces["forces"]; index: number }[]) {
  return frames.map(({ atoms, energy, forces, index }) => {
    const rows = atoms.map((atom, i) => [atom.element, atom.x, atom.y, atom.z, ...forces[i]].join(" "));
    return `${atoms.length}\nProperties=species:S:1:pos:R:3:forces:R:3 force_unit=kcal/mol/angstrom energy="${energy} kcal/mol" frame=${index}\n${rows.join("\n")}\n`;
  }).join("");
}

export const graphJobs: { [K in "properties" | "energy" | "energy_forces" | "frame_energy_forces" | "optimize" | "prepare_3d" | "conformers"]: AgentJobRunner<K> } = {
  properties: {
    unavailable: graphUnavailable,
    async run(input, params, { signal, timeoutMs }) {
      const deadline = performance.now() + timeoutMs;
      const properties = await runChemistryTask({ action: "properties", molecule: input.structure! }, { signal, timeoutMs });
      const remainingMs = deadline - performance.now();
      if (params.chargeModel && remainingMs <= 0) throw new Error("Calculation exceeded the browser time limit.");
      const partialCharges = params.chargeModel === "Gasteiger"
        ? await runChemistryTask({ action: "charges", molecule: input.structure! }, { signal, timeoutMs: remainingMs }) : undefined;
      return { summary: { method: "OpenChemLib", ...properties, ...(partialCharges ? { partialCharges } : {}) }, artifacts: [] };
    },
  },
  energy: {
    unavailable: graphUnavailable,
    async run(input, { forceField }, { signal, timeoutMs }) {
      return { summary: { method: label(forceField), forceField, energy: await runChemistryTask({ action: "energy", molecule: input.structure!, forceField }, { signal, timeoutMs }), unit: "kcal/mol" }, artifacts: [] };
    },
  },
  energy_forces: {
    unavailable: snapshot => graphUnavailable(snapshot) ?? (snapshot.structure!.atoms.length > NUMERICAL_ATOMS ? "Forces support at most 64 atoms." : null),
    async run(input, { forceField }, { signal, timeoutMs, stem, artifact }) {
      const molecule = input.structure!, result = await runChemistryTask({ action: "energy-forces", molecule, forceField }, { signal, timeoutMs });
      const magnitudes = result.forces.map((force) => Math.hypot(...force));
      const forces = JSON.stringify({ forceField, unit: result.forceUnit, energy: result.energy, energyUnit: result.energyUnit, method: result.method, stepAngstrom: result.stepAngstrom, atoms: molecule.atoms.map((atom, index) => ({ index, element: atom.element, force: result.forces[index] })) }, null, 1);
      return {
        summary: { method: forceField === "UFF" ? "UFF (RDKit), analytic" : `${forceField} (OpenChemLib), central difference`, forceField, energy: result.energy, energyUnit: result.energyUnit, forceUnit: result.forceUnit, maxForce: Math.max(...magnitudes), rmsForce: Math.sqrt(magnitudes.reduce((sum, value) => sum + value * value, 0) / magnitudes.length), atomCount: magnitudes.length },
        artifacts: [await artifact("forces", `${stem}-forces.json`, "application/json", `${forces}\n`)],
      };
    },
  },
  frame_energy_forces: {
    unavailable(snapshot) {
      const batch = batchSource(snapshot);
      if (!batch) return snapshot.structureError ?? snapshot.sourceError ?? "This source has no frames with a chemical graph.";
      if (batch.kind === "frames") return graphUnavailable(snapshot) ?? (snapshot.structure!.atoms.length > NUMERICAL_ATOMS ? "Forces support at most 64 atoms." : null);
      return null;
    },
    paramsUnavailable(snapshot, { offset, count }) {
      const batch = batchSource(snapshot)!;
      if (offset >= batch.count) return `offset must be below the ${batch.count} frames of this source.`;
      const atoms = batchAtoms(snapshot, batch);
      return count !== undefined && count * atoms > WORKBENCH_LIMITS.batchAtomFrames ? `${count} frames of ${atoms} atoms exceed ${WORKBENCH_LIMITS.batchAtomFrames} atom-frames; request at most ${Math.floor(WORKBENCH_LIMITS.batchAtomFrames / atoms)}.` : null;
    },
    async run(input, { forceField, offset, count }, { signal, timeoutMs, stem, artifact }) {
      const batch = batchSource(input)!, records = batch.kind === "sdf-records" ? sdfRecords(input.text) : null;
      const size = count ?? Math.max(1, Math.min(WORKBENCH_LIMITS.batchFrames, Math.floor(WORKBENCH_LIMITS.batchAtomFrames / batchAtoms(input, batch))));
      const end = Math.min(batch.count, offset + size), options = { signal, timeoutMs };
      let frames: { atoms: MolecularAtom[]; result: EnergyForces }[];
      if (records) {
        // Every page is checked against the graph of the first record.
        const results = await runChemistryTask({ action: "record-forces", reference: records[0], records: records.slice(offset, end), firstIndex: offset, forceField }, options);
        frames = results.map(({ atoms, ...result }) => ({ atoms, result }));
      } else {
        const atoms = input.scientific?.frames.length ? input.scientific.frames.slice(offset, end).map(frame => frame.atoms) : [input.structure!.atoms];
        const results = await runChemistryTask({ action: "frame-forces", molecule: input.structure!, frames: atoms, forceField }, options);
        frames = results.map((result, i) => ({ atoms: atoms[i], result }));
      }
      const first = frames[0].result, magnitudes = frames.flatMap(frame => frame.result.forces.map(force => Math.hypot(...force)));
      const numbered = frames.map((frame, i) => ({ index: offset + i, atoms: frame.atoms, energy: frame.result.energy, forces: frame.result.forces }));
      const json = JSON.stringify({ forceField, method: first.method, ...(first.stepAngstrom ? { stepAngstrom: first.stepAngstrom } : {}), energyUnit: first.energyUnit, forceUnit: first.forceUnit, source: batch.kind, totalFrames: batch.count,
        atoms: frames[0].atoms.map((atom, index) => ({ index, element: atom.element })), frames: numbered.map(({ index, energy, forces }) => ({ frameIndex: index, energy, forces })) });
      return {
        summary: { method: first.method, forceField, model: label(forceField), source: batch.kind, totalFrames: batch.count, offset, frameCount: frames.length, nextOffset: end < batch.count ? end : null,
          atomCount: frames[0].atoms.length, energies: numbered.map(frame => frame.energy), energyUnit: first.energyUnit, forceUnit: first.forceUnit,
          maxForce: Math.max(...magnitudes), rmsForce: Math.sqrt(magnitudes.reduce((sum, value) => sum + value * value, 0) / magnitudes.length) },
        artifacts: [
          await artifact("forces", `${stem}-frames-${offset}-${end - 1}-forces.json`, "application/json", `${json}\n`),
          await artifact("extxyz", `${stem}-frames-${offset}-${end - 1}-forces.xyz`, "chemical/x-xyz", forcesExtendedXyz(numbered)),
        ],
      };
    },
  },
  optimize: {
    unavailable: graphUnavailable,
    paramsUnavailable(snapshot, { forceField, method, constraints }) {
      const atoms = snapshot.structure!.atoms;
      const reason = optimizationUnavailable(atoms.length, forceField, method, constraints.length);
      if (reason) return reason;
      try { resolveConstraints(atoms, constraints); } catch (error) { return error instanceof Error ? error.message : String(error); }
      return null;
    },
    async run(input, params, context) {
      const result = await runChemistryTask({ action: "optimize", molecule: input.structure!, options: params }, { signal: context.signal, timeoutMs: context.timeoutMs });
      return { summary: optimizationSummary(result), artifacts: await optimizationArtifacts(await structureSdf(input, result.molecule, context.signal), result, `${context.stem}-optimized`, context) };
    },
  },
  prepare_3d: {
    unavailable: snapshot => graphUnavailable(snapshot) ?? (flatDepiction(snapshot.structure!) ? null : "This structure already has 3D coordinates; use optimize."),
    paramsUnavailable: (snapshot, { forceField, method }) => optimizationUnavailable(snapshot.structure!.atoms.length, forceField, method, 0),
    async run(input, params, context) {
      const result = await runChemistryTask({ action: "prepare-3d", molecule: input.structure!, options: params }, { signal: context.signal, timeoutMs: context.timeoutMs });
      return { summary: { ...optimizationSummary(result), preparation: result.preparation, atomCount: result.molecule.atoms.length }, artifacts: await optimizationArtifacts(await structureSdf(input, result.molecule, context.signal), result, `${context.stem}-3d`, context) };
    },
  },
  conformers: {
    unavailable: graphUnavailable,
    async run(input, params, { signal, timeoutMs, stem, artifact }) {
      const search = await runChemistryTask({ action: "conformers", molecule: input.structure!, options: params }, { signal, timeoutMs });
      const records: string[] = [];
      for (const [index, conformer] of search.conformers.entries()) {
        records.push(conformerSdfRecord(await structureSdf(input, conformer.molecule, signal), index + 1, params.forceField, conformer.energy, conformer.relativeEnergy));
      }
      return {
        summary: { method: `OpenChemLib torsion sampling, ${params.forceField === "UFF" ? "RDKit UFF L-BFGS" : `OpenChemLib ${params.forceField} BFGS`} relaxation`, forceField: params.forceField, seed: search.seed,
          samples: search.generated, duplicates: search.duplicates, count: search.conformers.length, atomCount: search.conformers[0].molecule.atoms.length, unit: "kcal/mol",
          energies: search.conformers.map(item => item.energy), relativeEnergies: search.conformers.map(item => item.relativeEnergy), converged: search.conformers.map(item => item.converged) },
        artifacts: [await artifact("conformers", `${stem}-conformers.sdf`, "chemical/x-mdl-sdfile", records.join(""))],
      };
    },
  },
};
