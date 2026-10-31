/**
 * Names and signatures of compressed molecular files opened in the browser.
 * A compressed file opens as the text file inside it; `inner` names that file.
 * Only text formats the browser already opens are accepted inside, so a
 * compressed file never reaches a reader its uncompressed copy would not.
 */
export type CompressionCodec = "gzip" | "xz" | "zstd";

/** Decoded text kept for one document; tighter route limits apply on top. */
export const MAX_DECODED_BYTES = 64 * 1024 * 1024;
/** Largest XZ dictionary or Zstandard window the decoders allocate. */
export const MAX_DECODER_WINDOW_BYTES = 64 * 1024 * 1024;

const SUFFIXES: Record<string, { codec: CompressionCodec; label: string }> = {
  gz: { codec: "gzip", label: "gzip" },
  bgz: { codec: "gzip", label: "BGZF" },
  bgzf: { codec: "gzip", label: "BGZF" },
  xz: { codec: "xz", label: "XZ" },
  zst: { codec: "zstd", label: "Zstandard" },
  zstd: { codec: "zstd", label: "Zstandard" },
};

// Text formats the browser opens from an ordinary file, structures and tables
// (the browser drop set) and scientific outputs (the scientific import).
const INNER_EXTENSIONS = new Set([
  "arc", "cfg", "cif", "cms", "com", "cub", "cube", "csv", "data", "dump", "dwar", "ent",
  "fasta", "fch", "fchk", "fdf", "gro", "hess", "in", "inp", "lammpstrj", "lammps", "lmp", "log",
  "mae", "mcif", "mmcif", "mol", "mol2", "molden", "molf", "nw", "out", "pdb", "pdbqt", "ph4",
  "pqr", "psi4", "qcin", "rdf", "rxn", "sd", "sdf", "smi", "smiles", "tsv", "vasp", "xyz",
  "zmat", "zmatrix", "json", "qcschema", "cjson",
]);
const MOLDEN_INPUT = /(?:^|[._-])molden\.input$/iu;

export type CompressedName = {
  codec: CompressionCodec;
  /** Format named by the suffix, for messages ("BGZF" for .bgz). */
  label: string;
  /** The file inside: `1abc.pdb` for `1abc.pdb.gz`. */
  innerName: string;
  innerExtension: string;
  /**
   * Name a re-compressed copy of the current text is saved under, or null when
   * the browser cannot write that format. BGZF is written as plain gzip, so its copy is `.gz`.
   */
  exportName: string | null;
};

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

function baseName(name: string) {
  return name.split(/[\\/]/u).pop() || name;
}

/** The compression a file name declares, or null for an uncompressed name. Maestro `.maegz` is gzip. */
export function compressedName(name: string): CompressedName | null {
  const base = baseName(name);
  if (/\.maegz$/iu.test(base)) {
    const innerName = base.replace(/\.maegz$/iu, ".mae");
    return { codec: "gzip", label: "gzip", innerName, innerExtension: "mae", exportName: base };
  }
  const suffix = extensionOf(base);
  const entry = SUFFIXES[suffix];
  if (!entry) return null;
  const innerName = base.slice(0, -(suffix.length + 1));
  const exportSuffix = suffix === "bgz" || suffix === "bgzf" ? "gz" : suffix;
  return {
    codec: entry.codec,
    label: entry.label,
    innerName,
    innerExtension: extensionOf(innerName),
    exportName: exportSuffix ? `${innerName}.${exportSuffix}` : null,
  };
}

export function isCompressedName(name: string) {
  return compressedName(name) !== null;
}

/** The compressed name when the browser can open it; otherwise an error naming why. */
export function supportedCompressedName(name: string): CompressedName {
  const parsed = compressedName(name);
  const base = baseName(name);
  if (!parsed) throw new Error(`${base} is not a compressed file`);
  if (compressedName(parsed.innerName)) throw new Error(`${base} is compressed more than once`);
  if (!parsed.innerExtension && !MOLDEN_INPUT.test(parsed.innerName)) {
    throw new Error(`${base} does not name the format inside the ${parsed.label} file`);
  }
  if (!INNER_EXTENSIONS.has(parsed.innerExtension) && !MOLDEN_INPUT.test(parsed.innerName)) {
    throw new Error(`Compressed .${parsed.innerExtension} files cannot be opened in the browser`);
  }
  return parsed;
}

/** The format inside a compressed name the browser opens, or null. */
export function supportedInnerExtension(name: string) {
  try {
    return supportedCompressedName(name).innerExtension;
  } catch {
    return null;
  }
}

/** The format a file's first bytes identify; Zstandard files may start with a skippable frame. */
export function compressionFromSignature(bytes: Uint8Array): CompressionCodec | null {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (bytes.length >= 6 && bytes[0] === 0xfd && bytes[1] === 0x37 && bytes[2] === 0x7a
    && bytes[3] === 0x58 && bytes[4] === 0x5a && bytes[5] === 0x00) return "xz";
  if (bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) return "zstd";
  if (bytes.length >= 4 && (bytes[0] & 0xf0) === 0x50 && bytes[1] === 0x2a && bytes[2] === 0x4d && bytes[3] === 0x18) return "zstd";
  return null;
}

/** Decoded payloads that are themselves archives or compressed data. */
export function nestedArchiveSignature(bytes: Uint8Array) {
  if (compressionFromSignature(bytes)) return "compressed data";
  // "BZh", a block size digit and the block magic: all ASCII, so the whole signature is required.
  if (/^BZh[1-9]1AY&SY/u.test(String.fromCharCode(...bytes.subarray(0, 10)))) return "bzip2 data";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "a ZIP archive";
  if (bytes.length >= 4 && bytes[0] === 0x04 && bytes[1] === 0x22 && bytes[2] === 0x4d && bytes[3] === 0x18) return "LZ4 data";
  if (bytes.length >= 6 && bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf) return "a 7z archive";
  return null;
}

export function assertSignatureMatches(name: string, bytes: Uint8Array, expected: CompressionCodec) {
  const found = compressionFromSignature(bytes);
  if (found === expected) return;
  const base = baseName(name);
  const label = compressedName(name)?.label ?? expected;
  throw new Error(found
    ? `${base} is named as ${label} but contains ${found === "gzip" ? "gzip" : found === "xz" ? "XZ" : "Zstandard"} data`
    : `${base} is named as ${label} but is not ${label} data`);
}

export function formatMiB(bytes: number) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`;
}

/** File chooser filter for compressed files; the chooser cannot match inner formats, the open checks them. */
export const COMPRESSED_FILE_ACCEPT = ".gz,.bgz,.bgzf,.xz,.zst,.zstd,.maegz";
