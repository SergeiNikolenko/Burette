/** Metadata for one SDF record. Atom entries follow displayed connection-table order. */
export type GraphResidue = { name: string; sequence: number; chain: string; insertionCode: string };
export type GraphMetadata = {
  version: 1;
  atoms: { id: string; atomName?: string; residue?: GraphResidue }[];
  conformer: { id: string; label?: string };
};
export type GraphMetadataPatch = {
  atoms?: { id: string; atomName?: string | null; residue?: GraphResidue | null }[];
  conformerLabel?: string | null;
};
const TAG = "BURETTE_METADATA_V1";
const MAX_BYTES = 64 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fail = (): never => { throw new Error("Invalid or oversized SDF metadata."); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail();
  return value as Record<string, unknown>;
}
function label(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.length) || value.length > max || /[\p{Cc}\p{Cf}]/u.test(value)) fail();
  return value as string;
}
function residue(value: unknown): GraphResidue {
  const item = object(value, ["name", "sequence", "chain", "insertionCode"]);
  if (!Number.isInteger(item.sequence) || Math.abs(item.sequence as number) > 999999) fail();
  return { name: label(item.name, 32), sequence: item.sequence as number, chain: label(item.chain, 32, true), insertionCode: label(item.insertionCode, 4, true) };
}
/** Validate and copy at the document boundary; callers cannot mutate an earlier snapshot. */
export function validateGraphMetadata(value: unknown, atomCount: number): GraphMetadata {
  if (!Number.isInteger(atomCount) || atomCount < 1 || atomCount > 256) fail();
  const item = object(value, ["version", "atoms", "conformer"]);
  if (item.version !== 1 || !Array.isArray(item.atoms) || item.atoms.length !== atomCount) fail();
  const ids = new Set<string>();
  const id = (value: unknown) => { if (typeof value !== "string" || value.length !== 36 || !uuid.test(value) || ids.has(value.toLowerCase())) fail(); ids.add((value as string).toLowerCase()); return value as string; };
  const atoms = (item.atoms as unknown[]).map(value => {
    const atom = object(value, ["id", "atomName", "residue"]);
    return { id: id(atom.id), ...(atom.atomName === undefined ? {} : { atomName: label(atom.atomName, 32) }), ...(atom.residue === undefined ? {} : { residue: residue(atom.residue) }) };
  });
  const conformer = object(item.conformer, ["id", "label"]);
  const result: GraphMetadata = { version: 1, atoms, conformer: { id: id(conformer.id), ...(conformer.label === undefined ? {} : { label: label(conformer.label, 128) }) } };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_BYTES) fail();
  return result;
}

function reservedBlock(data: string) {
  const lines = data.split("\n");
  let found: { start: number; end: number; value: string } | null = null;
  for (let start = 0; start < lines.length; start++) {
    // An SD data item begins only at the start or after an empty value terminator.
    // Header-shaped text inside a foreign multiline value is ordinary content.
    if ((start > 0 && lines[start - 1].trim()) || !/^>[^<]*<BURETTE_METADATA_V1(?:>|$)/u.test(lines[start])) continue;
    if (!/^>[^\n]*<BURETTE_METADATA_V1>[^\n]*$/u.test(lines[start]) || found) fail();
    let end = start + 1;
    while (end < lines.length && lines[end].trim()) end++;
    const value = lines.slice(start + 1, end).join("\n");
    if (new TextEncoder().encode(value).length > MAX_BYTES) fail();
    found = { start, end: end < lines.length ? end + 1 : end, value };
  }
  return { lines, found };
}
export function hasGraphMetadata(data: string) { return Boolean(reservedBlock(data).found); }
/** Read only our reserved data item; absence starts a new document identity. */
export function readGraphMetadata(data: string, atomCount: number): GraphMetadata {
  if (!Number.isInteger(atomCount) || atomCount < 1 || atomCount > 256) fail();
  const { found } = reservedBlock(data);
  if (found) {
    try { return validateGraphMetadata(JSON.parse(found.value), atomCount); } catch { return fail(); }
  }
  return validateGraphMetadata({ version: 1, atoms: Array.from({ length: atomCount }, () => ({ id: crypto.randomUUID() })), conformer: { id: crypto.randomUUID() } }, atomCount);
}
export function graphMetadataData(data: string, metadata: GraphMetadata): string {
  const valid = validateGraphMetadata(metadata, metadata.atoms.length);
  const { lines, found } = reservedBlock(data);
  if (found) {
    // A corrupt reserved item is never silently repaired by an unrelated graph edit.
    try { const previous = JSON.parse(found.value); validateGraphMetadata(previous, previous.atoms?.length); } catch { fail(); }
    lines.splice(found.start, found.end - found.start);
  }
  const foreign = lines.join("\n").replace(/\n+$/u, "");
  return `${foreign ? `${foreign}\n\n` : ""}> <${TAG}>\n${JSON.stringify(valid)}`;
}
export function patchGraphMetadata(metadata: GraphMetadata, patch: GraphMetadataPatch): GraphMetadata {
  object(patch, ["atoms", "conformerLabel"]);
  const next = validateGraphMetadata(metadata, metadata.atoms.length);
  if (patch.atoms !== undefined) {
    if (!Array.isArray(patch.atoms) || patch.atoms.length > next.atoms.length) fail();
    const seen = new Set<string>();
    for (const change of patch.atoms) {
      object(change, ["id", "atomName", "residue"]);
      const atom = next.atoms.find(atom => atom.id === change.id) ?? fail();
      if (seen.has(change.id)) fail();
      seen.add(change.id);
      for (const key of ["atomName", "residue"] as const) {
        if (change[key] === null) delete atom[key];
        else if (change[key] !== undefined) Object.assign(atom, { [key]: change[key] });
      }
    }
  }
  if (patch.conformerLabel === null) delete next.conformer.label;
  else if (patch.conformerLabel !== undefined) next.conformer.label = patch.conformerLabel;
  return validateGraphMetadata(next, next.atoms.length);
}
/** The worker's provenance refers to the operation input, never element/position matching. */
export function remapGraphMetadata(metadata: GraphMetadata, sourceAtomIndices: number[]): GraphMetadata {
  if (!Array.isArray(sourceAtomIndices) || sourceAtomIndices.length < 1 || sourceAtomIndices.length > 256) fail();
  const valid = validateGraphMetadata(metadata, metadata.atoms.length), seen = new Set<number>();
  const atoms = sourceAtomIndices.map(index => {
    if (index === -1) return { id: crypto.randomUUID() };
    if (!Number.isInteger(index) || !valid.atoms[index] || seen.has(index)) fail();
    seen.add(index);
    return valid.atoms[index];
  });
  return validateGraphMetadata({ ...valid, atoms }, atoms.length);
}
