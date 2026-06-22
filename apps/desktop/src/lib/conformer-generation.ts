import type { ViewerPreferences } from "../types";

export type ConformerGenerationResult = {
  title: string;
  extension: "sdf";
  text: string;
  method: string;
  conformerCount?: number;
};

export type ConformerGenerationMode = "single" | "ensemble";
export type MolstarStylePreference = ViewerPreferences["molstarStyle"];

export function generated3DPoseSetTitle(title: string, text: string) {
  const poseCount = sdfRecordBlocks(text).length;
  if (poseCount <= 1) return title;
  return title;
}

export function generated3DPoseSetText(sourceText: string, sourceExtension: string, generatedText: string, mode: ConformerGenerationMode = "single") {
  const generatedRecords = sdfRecordBlocks(generatedText);
  const sourceRecords = sourcePoseRecordBlocks(sourceText, sourceExtension);
  const alignedGeneratedRecords = alignGeneratedPoseRecordsToSource(generatedRecords, sourceRecords[0]);
  const records = mode === "ensemble" ? alignedGeneratedRecords : [...alignedGeneratedRecords, ...sourceRecords];
  return records.length > 0 ? `${records.join("\n")}\n` : generatedText;
}

export function normalizeMolstarStylePreference(value: unknown): MolstarStylePreference | null {
  return value === "illustrative" || value === "default" ? value : null;
}

function sourcePoseRecordBlocks(text: string, extension: string) {
  const normalizedExtension = extension.trim().toLowerCase().replace(/^\./u, "");
  if (normalizedExtension === "sdf" || normalizedExtension === "sd") return sdfRecordBlocks(text);
  if (normalizedExtension === "mol") {
    const value = text.trimEnd();
    return value ? [`${value}\n$$$$`] : [];
  }
  return [];
}

function sdfRecordBlocks(text: string) {
  return text
    .split("$$$$")
    .map((record) => record.trimEnd())
    .filter((record) => record.trim().length > 0)
    .map((record) => `${record}\n$$$$`);
}

type MolBlockAtomCoordinates = {
  atomCount: number;
  atomStart: number;
  centroid: [number, number, number];
  coordinates: Array<[number, number, number]>;
  lines: string[];
};

function alignGeneratedPoseRecordsToSource(records: string[], sourceRecord: string | undefined) {
  const source = sourceRecord ? readMolBlockAtomCoordinates(sourceRecord) : null;
  if (!source) return records;
  return records.map((record) => alignMolBlockCentroid(record, source));
}

function alignMolBlockCentroid(record: string, source: MolBlockAtomCoordinates) {
  const target = readMolBlockAtomCoordinates(record);
  if (!target || target.atomCount !== source.atomCount) return record;
  const delta: [number, number, number] = [
    source.centroid[0] - target.centroid[0],
    source.centroid[1] - target.centroid[1],
    source.centroid[2] - target.centroid[2],
  ];
  const lines = [...target.lines];
  for (let offset = 0; offset < target.atomCount; offset += 1) {
    const lineIndex = target.atomStart + offset;
    const line = lines[lineIndex] ?? "";
    const [x, y, z] = target.coordinates[offset] ?? [0, 0, 0];
    lines[lineIndex] = `${formatMolCoordinate(x + delta[0])}${formatMolCoordinate(y + delta[1])}${formatMolCoordinate(z + delta[2])}${line.slice(30)}`;
  }
  return lines.join("\n");
}

function readMolBlockAtomCoordinates(record: string): MolBlockAtomCoordinates | null {
  const lines = record.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const countsIndex = lines.findIndex((line) => /^\s*\d+\s+\d+\s/u.test(line));
  if (countsIndex < 0) return null;
  const atomCount = Number(lines[countsIndex]?.slice(0, 3));
  if (!Number.isFinite(atomCount) || atomCount <= 0) return null;
  const atomStart = countsIndex + 1;
  const coordinates: Array<[number, number, number]> = [];
  for (let index = atomStart; index < atomStart + atomCount; index += 1) {
    const line = lines[index] ?? "";
    const x = Number(line.slice(0, 10));
    const y = Number(line.slice(10, 20));
    const z = Number(line.slice(20, 30));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    coordinates.push([x, y, z]);
  }
  if (coordinates.length !== atomCount) return null;
  const centroid = coordinates.reduce<[number, number, number]>(
    (sum, [x, y, z]) => [sum[0] + x, sum[1] + y, sum[2] + z],
    [0, 0, 0],
  ).map((value) => value / atomCount) as [number, number, number];
  return { atomCount, atomStart, centroid, coordinates, lines };
}

function formatMolCoordinate(value: number) {
  const text = value.toFixed(4);
  return text.length <= 10 ? text.padStart(10) : text.slice(0, 10);
}

export function textToBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function generated3DStatus(conformer: ConformerGenerationResult, action: string) {
  const depth = conformerZDepth(conformer.text);
  const count = Number(conformer.conformerCount || 0);
  const subject = count > 1 ? `${count} 3D conformers` : "3D conformer";
  const depthLabel = depth === null
    ? ""
      : depth <= 0.05
        ? ` (z-depth ${depth.toFixed(2)} A, planar)`
        : ` (z-depth ${depth.toFixed(2)} A)`;
  return `Generated ${subject} with ${conformer.method}${depthLabel} and ${action}`;
}

export function conformerGenerationPreferences(preferences: ViewerPreferences) {
  return {
    engine: preferences.conformerEngine,
    candidateCount: preferences.conformerCandidateCount,
    rmsdCutoff: preferences.conformerRmsdCutoff,
  };
}

export function conformerGenerationTaskLabel(mode: ConformerGenerationMode) {
  return mode === "ensemble" ? "3D conformer set" : "3D conformer";
}

function conformerZDepth(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const countsIndex = lines.findIndex((line) => /^\s*\d+\s+\d+\s/u.test(line));
  if (countsIndex < 0) return null;
  const atomCount = Number(lines[countsIndex]?.slice(0, 3));
  if (!Number.isFinite(atomCount) || atomCount <= 0) return null;
  const zValues: number[] = [];
  for (let index = countsIndex + 1; index < countsIndex + 1 + atomCount; index += 1) {
    const z = Number(lines[index]?.slice(20, 30));
    if (Number.isFinite(z)) zValues.push(z);
  }
  if (zValues.length === 0) return null;
  return Math.max(...zValues) - Math.min(...zValues);
}
