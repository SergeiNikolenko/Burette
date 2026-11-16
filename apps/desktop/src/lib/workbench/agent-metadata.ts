import type { WorkbenchMetadataEdit } from "../../../../../scripts/workbench-agent-contract.mjs";
import { graphDraftText } from "./graph-draft";
import { hasGraphMetadata, patchGraphMetadata, readGraphMetadata, type GraphMetadata } from "./graph-metadata";
import type { AgentJobRunner } from "./agent-jobs";
import type { Snapshot } from "./agent-source";

/** Inspect serialized metadata without assigning identities to an ordinary read. */
function metadataSource(snapshot: Snapshot) {
  const atomCount = snapshot.source?.atoms.length ?? 0;
  if (!["sdf", "sd"].includes(snapshot.extension)) throw new Error("Metadata editing requires one SDF record; MOL and other formats cannot carry this metadata.");
  if (snapshot.sdfRecords !== 1) throw new Error("Metadata editing requires one SDF record; collections are unsupported.");
  if (atomCount < 1 || atomCount > 256) throw new Error("Metadata editing supports 1–256 atoms.");
  const lines = snapshot.text.replace(/\r\n?/gu, "\n").split(/^\$\$\$\$[^\n]*$/mu)[0].split("\n"), end = lines.findIndex(line => /^M {2}END\s*$/u.test(line));
  if (end < 0) throw new Error("The SDF connection table is incomplete.");
  const data = lines.slice(end + 1).join("\n").replace(/^\n+/u, "");
  return { atomCount, table: lines.slice(0, end + 1).join("\n"), data, metadata: hasGraphMetadata(data) ? readGraphMetadata(data, atomCount) : null };
}

/** A separate SDF result; table order, coordinates and bond records remain intact. */
function editMetadata(snapshot: Snapshot, params: WorkbenchMetadataEdit) {
  const source = metadataSource(snapshot);
  const previous: GraphMetadata = source.metadata ?? readGraphMetadata(source.data, source.atomCount);
  const metadata = patchGraphMetadata(previous, {
    atoms: params.atoms.map(({ index, ...change }) => {
      if (!previous.atoms[index]) throw new Error(`Metadata atom indices must be below ${source.atomCount}.`);
      return { id: previous.atoms[index].id, ...change };
    }),
    ...(params.conformerLabel === undefined ? {} : { conformerLabel: params.conformerLabel }),
  });
  return { text: graphDraftText(snapshot.text, snapshot.extension, source.table, metadata), summary: {
    atomCount: source.atomCount, editedAtomCount: params.atoms.length, conformer: metadata.conformer, identitiesCreated: source.metadata === null,
  } };
}

const reason = (run: () => unknown) => { try { run(); return null; } catch (error) { return error instanceof Error ? error.message : String(error); } };

export const metadataJob: AgentJobRunner<"metadata_edit"> = {
  unavailable: snapshot => reason(() => metadataSource(snapshot)),
  paramsUnavailable: (snapshot, params) => params.atoms.some(atom => atom.index >= snapshot.source!.atoms.length) ? `Metadata atom indices must be below ${snapshot.source!.atoms.length}.` : null,
  async run(input, params, { stem, artifact }) {
    const result = editMetadata(input, params);
    return { summary: result.summary, artifacts: [await artifact("structure", `${stem}-metadata.sdf`, "chemical/x-mdl-sdfile", result.text)] };
  },
};
