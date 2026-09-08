import { readStructureTextDocument } from "../lib/structure-text";
import { writeClipboardText } from "../lib/clipboard";
import { loadDerivedEngines } from "../lib/derived-columns";

async function chemicalFileValues(paths: string[], format: "smiles" | "inchi") {
  const { rdkit } = await loadDerivedEngines();
  const values: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const source = await readStructureTextDocument(path, undefined, { maxBytes: 4 * 1024 * 1024 });
    bytes += new TextEncoder().encode(source.content).byteLength;
    if (source.truncated || bytes > 8 * 1024 * 1024) throw new Error("Copy at most 8 MB of molecule data at a time.");
    const extension = path.split('.').pop()?.toLowerCase();
    const records = extension === "sdf" || extension === "sd"
      ? source.content.replace(/\r\n/g, '\n').split(/\n\$\$\$\$[^\S\n]*(?:\n|$)/).filter(record => record.trim())
      : extension === "mol" ? [source.content] : source.content.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#')).map(line => line.trim().split(/\s+/)[0]);
    for (const record of records) {
      if (values.length >= 200) throw new Error("Copy at most 200 molecules at a time; use the collection export for more.");
      const molecule = rdkit.get_mol(record);
      if (!molecule) throw new Error(`Cannot parse a molecule in ${path.split('/').pop()}. Nothing was copied.`);
      try {
        const value = format === "inchi" ? molecule.get_inchi() : molecule.get_smiles();
        if (!value) throw new Error(`Could not calculate ${format}. Nothing was copied.`);
        values.push(value);
      } finally { molecule.delete(); }
    }
  }
  if (!values.length) throw new Error("No molecules were found.");
  return values;
}

export async function copyChemicalFiles(paths: string[], format: "smiles" | "inchi") {
  await writeClipboardText((await chemicalFileValues(paths, format)).join('\n'));
}
export async function validatePoseFiles(paths: string[]) {
  const identities = await chemicalFileValues(paths, "smiles");
  if (new Set(identities).size !== 1) throw new Error("As Poses requires the same molecule. Use Together for different molecules.");
}
export async function validatePoseRecords(records: { text: string }[]) {
  const { rdkit } = await loadDerivedEngines();
  const identities = [];
  for (const record of records) {
    const molecule = rdkit.get_mol(record.text);
    if (!molecule) throw new Error("Could not verify the selected poses.");
    try { identities.push(molecule.get_smiles()); } finally { molecule.delete(); }
  }
  if (identities.some(value => !value) || new Set(identities).size !== 1) throw new Error("As Poses requires the same molecule. Use Together for different molecules.");
}
