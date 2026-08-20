import { readStructureText } from "./structure-text";

const STRUCTURE_COLUMN_NAME = /^(canonical[_ -]?smiles|smiles|isomeric[_ -]?smiles|inchi|molfile|mol[_ -]?block|structure)$/i;
const SMILES_CHARSET = /^[A-Za-z0-9@+\-\[\]()=#$/\\%.:*]+$/;
const SMILES_MARKERS = /[()=#@\[\]]/;
const SNIFF_BYTES = 64 * 1024;
const SNIFF_ROWS = 25;

// Decides whether a delimited file belongs to the chemistry grid (a structure
// column becomes a 2D molecule grid) or to the plain Retab table viewer. A named
// structure column always wins; otherwise a column where most sampled values look
// like SMILES (right charset plus ring/bond/stereo markers) counts as molecular.
export async function isMolecularDelimitedFile(path: string) {
  let text: string;
  try {
    text = await readStructureText(path, { maxBytes: SNIFF_BYTES });
  } catch {
    return true;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return false;
  const delimiter = /\.tsv$/iu.test(path) || lines[0].includes("\t") ? "\t" : ",";
  const header = splitDelimitedLine(lines[0], delimiter);
  if (header.some((cell) => STRUCTURE_COLUMN_NAME.test(cell.trim()))) return true;

  const rows = lines.slice(1, 1 + SNIFF_ROWS).map((line) => splitDelimitedLine(line, delimiter));
  if (rows.length === 0) return false;
  for (let column = 0; column < header.length; column += 1) {
    let smilesLike = 0;
    let sampled = 0;
    for (const row of rows) {
      const value = row[column]?.trim();
      if (!value) continue;
      sampled += 1;
      if (value.length >= 3 && SMILES_CHARSET.test(value) && SMILES_MARKERS.test(value)) smilesLike += 1;
    }
    if (sampled >= 3 && smilesLike / sampled >= 0.8) return true;
  }
  return false;
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}
