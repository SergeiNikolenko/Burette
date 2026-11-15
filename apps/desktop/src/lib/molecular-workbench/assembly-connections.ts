import type { CifCategory } from "@molstar/io/reader/cif/data-model";
import { CifWriter } from "@molstar/io/writer/cif";

type Chain = { id: string; author: string };
export const assemblyChainKey = (label: string, entity: string, transform: string) => JSON.stringify([label, entity, transform]);
const known = (category: CifCategory, name: string, row: number) => {
  const field = category.getField(name);
  return field?.valueKind(row) === 0 ? field.str(row) : "";
};

/** Resolve deposited connections against actual atoms in the chosen model. PDB
 * conversion may assign one label to several entities, so chain names alone
 * cannot resolve a partner. Omit unsupported/ambiguous records with a warning. */
export function writeAssemblyConnections(
  encoder: ReturnType<typeof CifWriter.createEncoder>, sites: CifCategory,
  connections: CifCategory | undefined, selectedRows: number[],
  chainCopies: Map<string, Chain>, transformations: Set<string>, remainingBytes: number,
) {
  if (!connections?.rowCount) return [];
  const index = new Map<string, number[]>();
  for (const row of selectedRows) {
    const key = JSON.stringify([known(sites, "label_asym_id", row), known(sites, "label_atom_id", row)]);
    const rows = index.get(key) ?? [];
    rows.push(row); index.set(key, rows);
  }
  let comparisons = 0;
  const resolve = (source: number, partner: number) => {
    const label = known(connections, `ptnr${partner}_label_asym_id`, source);
    const atom = known(connections, `ptnr${partner}_label_atom_id`, source);
    if (!label || !atom) return undefined;
    const candidates = index.get(JSON.stringify([label, atom])) ?? [];
    const matches: number[] = [];
    const selectors = [
      [`ptnr${partner}_label_comp_id`, "label_comp_id"],
      [`ptnr${partner}_label_seq_id`, "label_seq_id"],
      [`ptnr${partner}_auth_seq_id`, "auth_seq_id"],
      [`ptnr${partner}_auth_comp_id`, "auth_comp_id"],
      [`ptnr${partner}_auth_asym_id`, "auth_asym_id"],
      [`pdbx_ptnr${partner}_label_alt_id`, "label_alt_id"],
      [`pdbx_ptnr${partner}_PDB_ins_code`, "pdbx_PDB_ins_code"],
    ];
    for (const row of candidates) {
      if (++comparisons > 1_000_000) throw new Error("Assembly connection matching exceeds the browser limit.");
      if (selectors.every(([from, to]) => {
        const expected = known(connections, from, source), actual = known(sites, to, row);
        // Mol* PDB CONECT conversion emits label_seq_id=0 for non-polymers
        // while atom_site leaves it undefined. Author sequence is authoritative
        // in that case and is independently checked below, with ambiguity guards.
        if (to === "label_seq_id" && !actual && expected === "0" && known(connections, `ptnr${partner}_auth_seq_id`, source)) return true;
        return !expected || expected === actual;
      })) matches.push(row);
    }
    if (!matches.length) return undefined;
    // An unspecified altloc may match several conformers of the same atom, but
    // must never join different residues/entities sharing an author chain.
    const identities = new Set(matches.map(row => JSON.stringify(["label_entity_id", "label_seq_id", "auth_seq_id", "pdbx_PDB_ins_code", "label_comp_id"].map(name => known(sites, name, row)))));
    if (identities.size !== 1) return undefined;
    return { label, entity: known(sites, "label_entity_id", matches[0]) };
  };
  const mapped: { source: number; first: Chain; second: Chain }[] = [];
  let omitted = 0;
  for (let source = 0; source < connections.rowCount; source++) {
    const symmetry = [1, 2].map(i => known(connections, `ptnr${i}_symmetry`, source));
    const hasThirdPartner = connections.fieldNames.some(name => /^(?:pdbx_)?ptnr3_/.test(name) && known(connections, name, source));
    if (hasThirdPartner || symmetry.some(value => value && value !== "1_555")) { omitted++; continue; }
    const firstAtom = resolve(source, 1), secondAtom = resolve(source, 2);
    if (!firstAtom || !secondAtom) { omitted++; continue; }
    const rowBytes = connections.fieldNames.reduce((sum, name) => sum + connections.getField(name)!.str(source).length * 4 + 8, 256);
    let count = 0;
    for (const transform of transformations) {
      const first = chainCopies.get(assemblyChainKey(firstAtom.label, firstAtom.entity, transform));
      const second = chainCopies.get(assemblyChainKey(secondAtom.label, secondAtom.entity, transform));
      if (!first || !second) continue;
      if (mapped.length >= 250_000) throw new Error("Assembly connection export exceeds the browser limit.");
      // Replacement author identifiers may be much longer than absent/short
      // struct_conn fields. Count their actual expansion before serialization.
      const replacementBytes = (first.author.length + second.author.length + first.id.length + second.id.length) * 4 + 128;
      remainingBytes -= rowBytes + replacementBytes;
      if (remainingBytes < 0) throw new Error("Assembly export exceeds the 64 MB allocation budget.");
      mapped.push({ source, first, second }); count++;
    }
    if (!count) omitted++;
  }
  if (mapped.length) {
    const replacement: Record<string, (i: number) => string> = {
      id: i => `conn${i + 1}`, ptnr1_label_asym_id: i => mapped[i].first.id, ptnr2_label_asym_id: i => mapped[i].second.id,
      ptnr1_auth_asym_id: i => mapped[i].first.author, ptnr2_auth_asym_id: i => mapped[i].second.author,
      ptnr1_symmetry: () => "1_555", ptnr2_symmetry: () => "1_555",
    };
    const fields = connections.fieldNames.map(name => CifWriter.Field.str(name,
      (i: number) => replacement[name]?.(i) ?? connections.getField(name)!.str(mapped[i].source),
      { valueKind: (i: number) => replacement[name] ? 0 : connections.getField(name)!.valueKind(mapped[i].source) }));
    encoder.writeCategory({ name: "struct_conn", instance: () => ({ fields, source: [{ rowCount: mapped.length }] }) });
  }
  return omitted ? [`${omitted} connection records with absent/ambiguous atoms, unsupported partners or crystal symmetry were not exported.`] : [];
}
