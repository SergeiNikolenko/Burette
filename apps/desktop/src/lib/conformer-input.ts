import { splitSdfCollectionRecords } from "./collection-documents";

const VARIABLE_ATOMS_MESSAGE = "3D generation needs a fully specified molecule. Define the R-groups or wildcard atoms in a copy; keep this structure in 2D.";

// This is a narrow admission check, not a replacement for chemical parsing or
// sanitization. Alias text alone is not evidence of an unspecified atom.
function hasVariableAtoms(input: string, format: "molblock" | "smiles") {
  if (format === "smiles") return input.trim().split(/\s/u, 1)[0].includes("*");
  const lines = input.replace(/\r\n?/gu, "\n").split("\n");
  if (lines[3]?.includes("V2000")) {
    const count = Number.parseInt(lines[3].slice(0, 3), 10);
    if (!Number.isSafeInteger(count) || count < 1 || lines.length < count + 4) return false;
    return lines.slice(4, count + 4).some((line) => /^(?:R#|\*)$/u.test(line.slice(31, 34).trim()));
  }
  if (lines[3]?.includes("V3000")) {
    const start = lines.findIndex((line) => /^M  V30 BEGIN ATOM\s*$/u.test(line));
    const end = lines.findIndex((line) => /^M  V30 END ATOM\s*$/u.test(line));
    return start >= 0 && end > start && lines.slice(start + 1, end)
      .some((line) => /^M  V30\s+\d+\s+(?:R#|\*)\s/u.test(line));
  }
  return false;
}

export function assertConcreteConformerInput(input: string, format: "molblock" | "smiles") {
  if (hasVariableAtoms(input, format)) throw new Error(VARIABLE_ATOMS_MESSAGE);
}

export function assertConcreteConformerSource(source: { extension: string; text: string }) {
  const extension = source.extension.trim().replace(/^\./u, "").toLowerCase();
  const isMolblock = ["mol", "sdf", "sd"].includes(extension);
  if (!isMolblock && !["smi", "smiles"].includes(extension)) return;
  const records = isMolblock
    ? splitSdfCollectionRecords(source.text)
    : source.text.split(/\r?\n/u).filter((line) => line.trim() && !line.trim().startsWith("#"));
  // Keep mixed collections on the existing per-record failure path so valid
  // molecules still produce results. An entirely unspecified source cannot.
  if (records.length && records.every((input) => hasVariableAtoms(input, isMolblock ? "molblock" : "smiles"))) {
    throw new Error(VARIABLE_ATOMS_MESSAGE);
  }
}
