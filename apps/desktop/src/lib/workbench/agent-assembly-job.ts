import type { AssemblyFormat } from "../molecular-workbench/biological-assembly";
import { ASSEMBLY_TEXT_LIMIT, ASSEMBLY_TOO_LARGE, assemblyFormatOfName } from "./assembly-source";
import { runAssemblyTask } from "./assembly-task";
import type { AgentJobRunner } from "./agent-jobs";
import type { Snapshot } from "./agent-source";

const SUMMARY_ROWS = 50;
const formatOf = (snapshot: Snapshot): AssemblyFormat | null => assemblyFormatOfName(`source.${snapshot.extension}`);

/** One choice among several needs to be named; a single one is taken. */
function choose(kind: "assemblyId" | "modelNumber", requested: string | undefined, available: string[]) {
  if (requested !== undefined) {
    if (!available.includes(requested)) throw new Error(`job.params.${kind} must be one of ${available.slice(0, SUMMARY_ROWS).join(", ")}.`);
    return requested;
  }
  if (available.length === 1) return available[0];
  throw new Error(`This file defines ${available.length} ${kind === "assemblyId" ? "assemblies" : "models"}; set job.params.${kind} to one of ${available.slice(0, SUMMARY_ROWS).join(", ")}.`);
}

/** The Compute menu's Biological assembly: the deposited assembly as a new mmCIF, the source unchanged. */
export const biologicalAssemblyJob: AgentJobRunner<"biological_assembly"> = {
  unavailable(snapshot) {
    if (!formatOf(snapshot) || snapshot.crystal) return "Open a PDB or mmCIF file with a biological assembly.";
    return snapshot.text.length > ASSEMBLY_TEXT_LIMIT ? ASSEMBLY_TOO_LARGE : null;
  },
  async run(input, params, { signal, timeoutMs, stem, artifact }) {
    const format = formatOf(input)!, text = input.text;
    const listing = await runAssemblyTask({ action: "assemblies", text, format }, { signal, timeoutMs });
    const assemblyId = choose("assemblyId", params.assemblyId, listing.assemblies.map(({ id }) => id));
    const modelNumber = choose("modelNumber", params.modelNumber, listing.models);
    const result = await runAssemblyTask({ action: "assembly", text, format, assemblyId, modelNumber }, { signal, timeoutMs });
    const chosen = listing.assemblies.find(({ id }) => id === assemblyId)!;
    return {
      summary: {
        assemblyId, modelNumber, details: chosen.details, copies: chosen.copies, atomCount: result.atomCount, chainCount: result.chainCount, warnings: result.warnings,
        assemblies: listing.assemblies.slice(0, SUMMARY_ROWS), assemblyCount: listing.assemblies.length, models: listing.models.slice(0, SUMMARY_ROWS), modelCount: listing.models.length,
      },
      artifacts: [await artifact("structure", `${stem}-assembly-${assemblyId}${listing.models.length > 1 ? `-model-${modelNumber}` : ""}.cif`, "chemical/x-mmcif", result.cif)],
    };
  },
};
