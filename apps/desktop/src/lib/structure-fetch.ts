export type ParsedPdbFetchCommand = {
  command: string;
  pdbId: string;
};

export type ParsedSmilesCommand = {
  command: string;
  smiles: string;
};

const PDB_ID_PATTERN = /^[1-9][a-z0-9]{3}$/iu;

export function normalizePdbId(input: string) {
  const pdbId = input.trim().toUpperCase();
  return PDB_ID_PATTERN.test(pdbId) ? pdbId : null;
}

export function parsePdbFetchCommand(query: string): ParsedPdbFetchCommand | null {
  const trimmed = query.trim();
  const match = /^(fetch|pdb|rcsb)\s+(\S+)$/iu.exec(trimmed);
  if (!match) return null;
  const pdbId = normalizePdbId(match[2]);
  return pdbId ? { command: trimmed, pdbId } : null;
}

export function parseSmilesCommand(query: string): ParsedSmilesCommand | null {
  const trimmed = query.trim();
  const match = /^(smiles?|smi|smil|ыьшдуы)\s+(.+)$/iu.exec(trimmed);
  if (!match) return null;
  const smiles = match[2].trim();
  return smiles ? { command: trimmed, smiles } : null;
}

export function rcsbPdbDownloadUrl(pdbId: string) {
  return `https://files.rcsb.org/download/${pdbId}.pdb`;
}
