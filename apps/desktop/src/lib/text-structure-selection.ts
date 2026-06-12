import type { TextFileDocument } from "../types";

export type TextStructureSelector = Record<string, string | number | Array<string | number>>;

export type TextStructureSelection = {
  label: string;
  selector: TextStructureSelector;
  granularity: "atom" | "residue";
  lineCount: number;
};

type TextLine = {
  number: number;
  text: string;
  start: number;
  end: number;
};

type PdbAtomRecord = {
  serial: number | null;
  atomName: string;
  residueName: string;
  chainId: string;
  residueNumber: number | null;
  insertionCode: string;
};

export function textStructureSelectionFromRange(
  document: TextFileDocument,
  from: number,
  to: number,
  options: { preferAtom?: boolean } = {},
): TextStructureSelection | null {
  const selectedLines = selectedTextLines(document.content, from, to);
  if (selectedLines.length === 0) return null;
  const extension = document.extension.toLowerCase().replace(/^\./u, "");

  return pdbSelection(selectedLines, options) ??
    indexedAtomSelection(document.content, selectedLines, extension) ??
    null;
}

export function textStructureSelectionFromSelectedText(
  document: TextFileDocument,
  selectedText: string,
  options: { preferAtom?: boolean } = {},
): TextStructureSelection | null {
  if (!selectedText.trim()) return null;
  const selectedLines = selectedText
    .split(/\n/u)
    .map((line, index) => {
      const text = line.replace(/\r$/u, "");
      return { number: index, text, start: 0, end: text.length };
    })
    .filter((line) => line.text.trim());
  if (selectedLines.length === 0) return null;
  return pdbSelection(selectedLines, options);
}

function selectedTextLines(text: string, from: number, to: number) {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.max(0, Math.max(from, to));
  if (start === end) return [];
  const lines: TextLine[] = [];
  let offset = 0;
  for (const [index, line] of text.split(/\n/u).entries()) {
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    offset = lineEnd + 1;
    if (lineEnd <= start || lineStart >= end) continue;
    if (!line.trim()) continue;
    lines.push({ number: index, text: line.replace(/\r$/u, ""), start: lineStart, end: lineEnd });
  }
  return lines;
}

function pdbSelection(lines: TextLine[], options: { preferAtom?: boolean }): TextStructureSelection | null {
  const records = lines
    .map((line) => parsePdbAtomRecord(line.text))
    .filter((record): record is PdbAtomRecord => record !== null);
  if (records.length === 0) return null;

  if (options.preferAtom) {
    const atomSelection = pdbAtomSelection(records);
    if (atomSelection) return atomSelection;
  }

  const residueRecords = records.filter((record) => record.residueNumber !== null);
  const chainIds = uniqueStrings(residueRecords.map((record) => record.chainId).filter(Boolean));
  const residueNumbers = uniqueNumbers(residueRecords.flatMap((record) => (
    record.residueNumber === null ? [] : [record.residueNumber]
  )));
  if (chainIds.length <= 1 && residueNumbers.length > 0) {
    const selector: TextStructureSelector = {};
    if (chainIds[0]) selector.auth_asym_id = chainIds[0];
    if (residueNumbers.length === 1) selector.auth_seq_id = residueNumbers[0];
    else if (isContiguousNumberRange(residueNumbers)) {
      selector.beg_auth_seq_id = residueNumbers[0];
      selector.end_auth_seq_id = residueNumbers[residueNumbers.length - 1];
    } else {
      selector.auth_seq_id = residueNumbers;
    }
    return {
      label: residueSelectionLabel(chainIds[0], residueNumbers),
      selector,
      granularity: "residue",
      lineCount: records.length,
    };
  }

  return pdbAtomSelection(records);
}

function pdbAtomSelection(records: PdbAtomRecord[]): TextStructureSelection | null {
  const atomIds = uniqueNumbers(records.flatMap((record) => (
    record.serial === null ? [] : [record.serial]
  )));
  if (atomIds.length === 0) return null;
  return {
    label: atomIds.length === 1 ? `Atom ${atomIds[0]}` : `${atomIds.length} atoms`,
    selector: atomIds.length === 1 ? { atom_id: atomIds[0] } : { atom_id: atomIds },
    granularity: "atom",
    lineCount: records.length,
  };
}

function parsePdbAtomRecord(line: string): PdbAtomRecord | null {
  const record = line.slice(0, 6).trim();
  if (record !== "ATOM" && record !== "HETATM") return null;
  return {
    serial: finiteInteger(line.slice(6, 11).trim()),
    atomName: line.slice(12, 16).trim(),
    residueName: line.slice(17, 20).trim(),
    chainId: line.slice(21, 22).trim(),
    residueNumber: finiteInteger(line.slice(22, 26).trim()),
    insertionCode: line.slice(26, 27).trim(),
  };
}

function indexedAtomSelection(
  text: string,
  selectedLines: TextLine[],
  extension: string,
): TextStructureSelection | null {
  const lines = text.split(/\n/u).map((line) => line.replace(/\r$/u, ""));
  const atomLineRange = atomLineRangeFor(lines, extension);
  if (!atomLineRange) return null;
  const atomIndices = uniqueNumbers(selectedLines.flatMap((line) => {
    if (line.number < atomLineRange.start || line.number >= atomLineRange.end) return [];
    return [line.number - atomLineRange.start];
  }));
  if (atomIndices.length === 0) return null;
  return {
    label: atomIndices.length === 1 ? `Atom ${atomIndices[0] + 1}` : `${atomIndices.length} atoms`,
    selector: atomIndices.length === 1 ? { atom_index: atomIndices[0] } : { atom_index: atomIndices },
    granularity: "atom",
    lineCount: atomIndices.length,
  };
}

function atomLineRangeFor(lines: string[], extension: string) {
  if (extension === "xyz" || extension === "extxyz") {
    const atomCount = finiteInteger(lines[0]?.trim() ?? "");
    if (!atomCount || atomCount <= 0) return null;
    return { start: 2, end: Math.min(lines.length, atomCount + 2) };
  }
  if (extension === "gro") {
    const atomCount = finiteInteger(lines[1]?.trim() ?? "");
    if (!atomCount || atomCount <= 0) return null;
    return { start: 2, end: Math.min(lines.length, atomCount + 2) };
  }
  if (extension === "mol" || extension === "sdf" || extension === "sd") {
    const atomCount = finiteInteger(lines[3]?.slice(0, 3).trim() ?? "");
    if (!atomCount || atomCount <= 0) return null;
    return { start: 4, end: Math.min(lines.length, atomCount + 4) };
  }
  if (extension === "mol2") {
    return mol2AtomLineRange(lines);
  }
  if (extension === "cube" || extension === "cub") {
    const atomCount = Math.abs(finiteInteger(lines[2]?.trim().split(/\s+/u)[0] ?? "") ?? 0);
    if (!atomCount || atomCount <= 0) return null;
    return { start: 6, end: Math.min(lines.length, atomCount + 6) };
  }
  if (extension === "cif" || extension === "mmcif" || extension === "mcif") {
    return cifAtomLineRange(lines);
  }
  return null;
}

function mol2AtomLineRange(lines: string[]) {
  const atomStart = lines.findIndex((line) => line.trim().toUpperCase() === "@<TRIPOS>ATOM");
  if (atomStart < 0) return null;
  const firstAtom = atomStart + 1;
  const nextSection = lines.findIndex((line, index) => (
    index > atomStart && line.trim().toUpperCase().startsWith("@<TRIPOS>")
  ));
  const atomEnd = nextSection >= 0 ? nextSection : lines.length;
  return atomEnd > firstAtom ? { start: firstAtom, end: atomEnd } : null;
}

function cifAtomLineRange(lines: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().toLowerCase() !== "loop_") continue;
    let cursor = index + 1;
    const tags: string[] = [];
    while (cursor < lines.length && lines[cursor].trim().startsWith("_")) {
      tags.push(lines[cursor].trim().toLowerCase());
      cursor += 1;
    }
    if (!tags.some((tag) => tag.startsWith("_atom_site.")) && !tags.some((tag) => tag.startsWith("_atom_site_"))) {
      continue;
    }
    const hasCoordinateTag = tags.some((tag) => (
      tag === "_atom_site.cartn_x" || tag === "_atom_site_cartn_x" ||
      tag === "_atom_site.fract_x" || tag === "_atom_site_fract_x"
    ));
    if (!hasCoordinateTag) continue;
    const start = cursor;
    while (cursor < lines.length) {
      const trimmed = lines[cursor].trim();
      if (!trimmed || trimmed === "#") break;
      if (trimmed.toLowerCase() === "loop_" || trimmed.startsWith("_") || trimmed.toLowerCase().startsWith("data_")) break;
      cursor += 1;
    }
    return cursor > start ? { start, end: cursor } : null;
  }
  return null;
}

function finiteInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values.filter(Number.isFinite))).sort((left, right) => left - right);
}

function isContiguousNumberRange(values: number[]) {
  return values.every((value, index) => index === 0 || value === values[index - 1] + 1);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => (
    left.localeCompare(right, undefined, { numeric: true })
  ));
}

function residueSelectionLabel(chainId: string | undefined, residueNumbers: number[]) {
  const chain = chainId ? `Chain ${chainId} ` : "";
  if (residueNumbers.length === 1) return `${chain}residue ${residueNumbers[0]}`;
  return `${chain}residues ${residueNumbers[0]}-${residueNumbers[residueNumbers.length - 1]}`;
}
