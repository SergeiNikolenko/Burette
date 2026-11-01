import { compressedName } from "../compressed-files/formats";
import { decodeCompressedFile } from "../compressed-files/task";
import { GAMESS_SIGNATURE, MOLPRO_SIGNATURE, NWCHEM_SIGNATURE, PSI4_SIGNATURE, QCHEM_SIGNATURE, XTB_SIGNATURE, XTB_TRAJECTORY_SIGNATURE } from "../molecular-workbench/quantum/signatures";
/**
 * Which files an ordinary browser Open or drop hands to the scientific import,
 * the same parse and open path as "Open quantum output…". Formats only that
 * import reads are recognised by name; ORCA, Gaussian, GAMESS, NWChem, Psi4, Q-Chem, Molpro and xtb logs and QCSchema
 * JSON by their own start, so other logs and text files keep opening as before. XYZ stays an
 * ordinary structure unless it explicitly carries the reserved coordinate marker.
 */
const BY_NAME = /\.(?:fchk|fch|molden|molf|hess|cube|cub|zmat|zmatrix|qcschema|cjson)$|(?:^|[._-])molden\.input$/iu;
const OUTPUT = /\.(?:out|log|dat|json)$/iu;
const XYZ = /\.xyz$/iu;
// ORCA's banner, or the coordinate block the ORCA parser reads.
const ORCA = /O {3}R {3}C {3}A|CARTESIAN COORDINATES \(ANGSTROEM\)/u;
const GAUSSIAN = /Entering Gaussian System|Gaussian, Inc\.|Gaussian \d+:|^\s*(?:Standard|Input|Z-Matrix) orientation:/mu;
const QCSCHEMA = /"schema_name"\s*:\s*"(?:qcschema_(?:molecule|output|optimization_output)|qc_schema_output)"/u;
function recognized(name: string, text: string) {
  if (!/\.json$/iu.test(name)) return [ORCA, GAUSSIAN, GAMESS_SIGNATURE, NWCHEM_SIGNATURE, PSI4_SIGNATURE, QCHEM_SIGNATURE, MOLPRO_SIGNATURE, XTB_SIGNATURE, XTB_TRAJECTORY_SIGNATURE].some(signature => signature.test(text));
  // Inspect only the root schema field, including when the 64 KiB prefix
  // ends before the JSON document does. Nested molecule metadata is not a file schema.
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (depth === 1 && QCSCHEMA.test(text.slice(i).match(/^"schema_name"\s*:\s*"[^"\n]*"/u)?.[0] ?? '')) return true;
      while (++i < text.length && text[i] !== '"') if (text[i] === '\\') i++;
    } else if (text[i] === '{' || text[i] === '[') depth++;
    else if (text[i] === '}' || text[i] === ']') depth--;
  }
  return false;
}
const SNIFF_BYTES = 64 * 1024;

export const SCIENTIFIC_FILE_ACCEPT = ".fchk,.fch,.molden,.molf,.input,.hess,.cube,.cub,.zmat,.zmatrix,.out,.log,.dat,.qcschema,.cjson,.json";
/** The scientific parser reads at most 16 MiB of text. */
export const SCIENTIFIC_FILE_LIMIT = 16 * 1024 * 1024;

/** A name that can contain a scientific input; output/log/json still require content recognition. */
export function mayBeScientificFile(fileName: string) {
  const name = compressedName(fileName)?.innerName ?? fileName;
  return BY_NAME.test(name) || OUTPUT.test(name) || XYZ.test(name);
}

// A compressed output is recognised by the file inside it: water.fchk.gz, run.out.xz.
export async function isScientificFile(file: Pick<File, "name" | "slice">) {
  const compressed = compressedName(file.name);
  const name = compressed?.innerName ?? file.name;
  if (BY_NAME.test(name)) return true;
  if (!OUTPUT.test(name) && !XYZ.test(name)) return false;
  try {
    if (XYZ.test(name)) {
      const text = compressed
        ? (await decodeCompressedFile(file.name, file.slice(0, SCIENTIFIC_FILE_LIMIT), { prefixBytes: SCIENTIFIC_FILE_LIMIT })).text
        : await file.slice(0, SCIENTIFIC_FILE_LIMIT).text();
      // All reserved versions enter strict admission; malformed metadata must not fall back.
      return text.includes("BURETTE_INTERNAL_COORDINATES_V");
    }
    // Only the start is decoded; a compressed file larger than the import limit cannot be imported anyway.
    if (compressed) return recognized(name, (await decodeCompressedFile(file.name, file.slice(0, SCIENTIFIC_FILE_LIMIT), { prefixBytes: SNIFF_BYTES })).text);
    return recognized(name, await file.slice(0, SNIFF_BYTES).text());
  } catch {
    // An unreadable log is not recognised; the ordinary route reports its read error for that file alone.
    return false;
  }
}

export async function partitionScientificFiles<T extends Pick<File, "name" | "slice">>(files: T[]) {
  const scientific: T[] = [];
  const other: T[] = [];
  for (const file of files) (await isScientificFile(file) ? scientific : other).push(file);
  return { scientific, other };
}
