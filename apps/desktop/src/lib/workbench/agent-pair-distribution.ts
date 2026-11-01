import type { WorkbenchJobParams } from "../../../../../scripts/workbench-agent-contract.mjs";
import {
  PAIR_DISTRIBUTION_LIMITS, pairDistributionCsv, pairDistributionJson, selectPairs, validatePairDistributionRequest,
} from "../molecular-workbench/pair-distribution/pair-distribution";
import { runPairDistributionTask } from "../molecular-workbench/pair-distribution/pair-distribution-client";
import type { AgentJobRunner } from "./agent-jobs";
import type { WorkbenchSource } from "./structure";

/** Same periodic-source requirement as the interactive g(r) panel. */
function unavailable(source: WorkbenchSource | null, params?: WorkbenchJobParams<"pair_distribution">): string | null {
  if (!source?.cell) return "Open a structure with a unit cell to calculate g(r).";
  if (!source.atoms.length || source.atoms.length > PAIR_DISTRIBUTION_LIMITS.atoms) return `Pair distribution supports 1–${PAIR_DISTRIBUTION_LIMITS.atoms} atoms.`;
  const species = new Set(source.atoms.map((atom) => atom.element));
  if (species.size > PAIR_DISTRIBUTION_LIMITS.species) return `Pair distribution supports at most ${PAIR_DISTRIBUTION_LIMITS.species} elements.`;
  if (!params) return null;
  for (const selection of [params.centre, params.neighbour]) {
    if (selection !== null && !species.has(selection)) return `This cell has no ${selection} atoms.`;
  }
  try { validatePairDistributionRequest({ atoms: source.atoms, cell: source.cell, ...params }); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  return null;
}

/** Histograms leave through bounded artifacts; status carries scalar results only. */
export const pairDistributionJob: AgentJobRunner<"pair_distribution"> = {
  unavailable: snapshot => unavailable(snapshot.source),
  paramsUnavailable: (snapshot, params) => unavailable(snapshot.source, params),
  async run(input, params, { signal, timeoutMs, stem, artifact }) {
    const source = input.source!, result = await runPairDistributionTask({ atoms: source.atoms, cell: source.cell!, ...params }, { signal, timeoutMs });
    const selection = selectPairs(result, params.centre, params.neighbour);
    const context = { title: input.document.title, engine: "Burette periodic radial distribution 1" };
    return {
      summary: {
        boundary: "periodic", atomCount: result.atomCount, species: result.species, bins: result.bins,
        rMax: result.rMax, binWidth: result.binWidth, distanceUnit: "angstrom", pairs: result.pairs,
        centre: selection.centre, neighbour: selection.neighbour,
        centreCount: selection.centreCount, neighbourCount: selection.neighbourCount,
        minDistance: Number.isFinite(selection.minDistance) ? selection.minDistance : null,
        coordination: selection.coordination.at(-1) ?? 0,
      },
      artifacts: [
        await artifact("distribution", `${stem}-gr.json`, "application/json", pairDistributionJson(result, selection, context)),
        await artifact("csv", `${stem}-gr.csv`, "text/csv", pairDistributionCsv(result, selection, context)),
      ],
    };
  },
};
