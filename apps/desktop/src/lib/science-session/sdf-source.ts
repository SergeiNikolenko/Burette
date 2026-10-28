import { parseMolecule } from "../molecular-workbench/molecular-graph";
import { hasGraphMetadata, readGraphMetadata } from "../workbench/graph-metadata";
import { ScienceSessionError, SCIENCE_SESSION_LIMITS } from "./contracts";

/** One explicit graph in source atom order. Its exact text carries bonds, stereo and metadata. */
export function readSdfSource(text: string) {
  if (new TextEncoder().encode(text).byteLength > SCIENCE_SESSION_LIMITS.sourceBytes) throw new ScienceSessionError("source", "The scene source exceeds 16 MiB.");
  const structure = parseMolecule(text, "sdf");
  if (structure.atoms.length > 256) throw new ScienceSessionError("limit", "Graph scenes support at most 256 atoms.");
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const end = lines.findIndex(line => line.startsWith("M  END"));
  const data = lines.slice(end + 1).join("\n").split(/^\$\$\$\$[^\n]*$/mu)[0];
  const metadata = hasGraphMetadata(data) ? readGraphMetadata(data, structure.atoms.length) : null;
  return {
    elements: structure.atoms.map(atom => atom.element),
    positions: Float64Array.from(structure.atoms.flatMap(atom => [atom.x, atom.y, atom.z])),
    atomIds: metadata?.atoms.map(atom => atom.id) ?? null,
  };
}
