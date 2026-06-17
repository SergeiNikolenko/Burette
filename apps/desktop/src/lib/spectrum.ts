import type { TextFileDocument, ViewerDocument } from "../types";

export type SpectrumFormat = "ms" | "magma" | "mgf" | "msp" | "mzml" | "mzxml";

export type SpectrumPeak = {
  x: number;
  y: number;
  label?: string;
  annotations?: Record<string, string | number | boolean | null>;
};

export type SpectrumDocument = {
  id: string;
  title: string;
  kind: "ms1" | "ms2" | "unknown";
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  peaks: SpectrumPeak[];
  metadata: Record<string, string>;
};

export type SpectrumFile = {
  format: SpectrumFormat;
  title: string;
  spectra: SpectrumDocument[];
  metadata: Record<string, string>;
  warnings: string[];
};

export const spectrumExtensions = new Set(["ms", "magma", "mgf", "msp", "mzml", "mzxml"]);

export function isSpectrumExtension(extension: string) {
  return spectrumExtensions.has(extension.toLowerCase());
}

export function spectrumDocumentFromText(document: TextFileDocument): ViewerDocument {
  return {
    id: `spectrum:${stableHash(document.path)}`,
    path: document.path,
    title: document.title,
    extension: document.extension,
    renderer: "spectrum",
    runtimePath: "",
    byteCount: document.byteCount,
    virtual: false,
  };
}

export function parseSpectrumFile(input: {
  title: string;
  extension: string;
  content: string;
}): SpectrumFile {
  const format = normalizeSpectrumFormat(input.extension);
  if (format === "ms") return parseMsFile(input.title, input.content);
  if (format === "magma") return parseMagmaFile(input.title, input.content);
  if (format === "mgf") return parseMgfFile(input.title, input.content);
  if (format === "msp") return parseMspFile(input.title, input.content);
  if (format === "mzml") return parseMzmlFile(input.title, input.content);
  if (format === "mzxml") return parseMzxmlFile(input.title, input.content);
  throw new Error(`Unsupported spectrum format: ${input.extension}`);
}

export function spectrumSummary(file: SpectrumFile) {
  const spectraCount = file.spectra.length;
  const peakCount = file.spectra.reduce((total, spectrum) => total + spectrum.peaks.length, 0);
  const maxIntensity = Math.max(0, ...file.spectra.flatMap((spectrum) => spectrum.peaks.map((peak) => peak.y)));
  const xValues = file.spectra.flatMap((spectrum) => spectrum.peaks.map((peak) => peak.x));
  return {
    spectraCount,
    peakCount,
    maxIntensity,
    minX: xValues.length ? Math.min(...xValues) : null,
    maxX: xValues.length ? Math.max(...xValues) : null,
  };
}

function normalizeSpectrumFormat(extension: string): SpectrumFormat {
  const value = extension.toLowerCase().replace(/^\./u, "");
  if (value === "mzml") return "mzml";
  if (value === "mzxml") return "mzxml";
  if (isSpectrumExtension(value)) return value as SpectrumFormat;
  throw new Error(`Unsupported spectrum extension: ${extension}`);
}

function parseMsFile(title: string, content: string): SpectrumFile {
  const metadata: Record<string, string> = {};
  const peaks: SpectrumPeak[] = [];
  let inPeaks = false;
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      const body = line.slice(1).trim();
      const [key, ...rest] = body.split(/\s+/u);
      if (key?.toLowerCase() === "ms2peaks") {
        inPeaks = true;
        continue;
      }
      if (key) metadata[key] = rest.join(" ").trim();
      inPeaks = false;
      continue;
    }
    if (line.startsWith("#")) {
      const body = line.slice(1).trim();
      const [key, ...rest] = body.split(/\s+/u);
      if (key) metadata[key] = rest.join(" ").trim();
      continue;
    }
    if (!inPeaks) continue;
    const pair = parseNumberPair(line);
    if (pair) peaks.push({ x: pair[0], y: pair[1] });
  }
  return spectrumFile("ms", title, [{
    id: "ms2peaks",
    title: metadata.compound || title,
    kind: "ms2",
    xLabel: "m/z",
    yLabel: "Intensity",
    xUnit: "m/z",
    peaks,
    metadata,
  }], metadata);
}

function parseMagmaFile(title: string, content: string): SpectrumFile {
  const lines = content.split(/\r?\n/u).filter((line) => line.trim());
  const header = lines.shift()?.split("\t").map((value) => value.trim()) ?? [];
  const column = (name: string) => header.indexOf(name);
  const mzIndex = column("mz_observed");
  const intensityIndex = column("inten");
  const peaks = lines.map((line, index): SpectrumPeak | null => {
    const cells = line.split("\t");
    const x = Number(cells[mzIndex]);
    const y = Number(cells[intensityIndex]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const annotations: SpectrumPeak["annotations"] = {};
    for (const name of ["mz_corrected", "ppm_diff", "frag_mass", "frag_h_shift", "frag_base_form", "frag_hashes"]) {
      const value = cells[column(name)];
      if (value !== undefined && value !== "") annotations[name] = numericIfPossible(value);
    }
    return {
      x,
      y,
      label: typeof annotations.frag_base_form === "string" ? annotations.frag_base_form : undefined,
      annotations: { row: index + 1, ...annotations },
    };
  }).filter((peak): peak is SpectrumPeak => peak !== null);
  return spectrumFile("magma", title, [{
    id: "magma",
    title,
    kind: "ms2",
    xLabel: "m/z observed",
    yLabel: "Intensity",
    xUnit: "m/z",
    peaks,
    metadata: { annotation: "MAGMa fragments" },
  }], { annotation: "MAGMa fragments" });
}

function parseMgfFile(title: string, content: string): SpectrumFile {
  const spectra: SpectrumDocument[] = [];
  let metadata: Record<string, string> | null = null;
  let peaks: SpectrumPeak[] = [];
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (/^BEGIN IONS$/iu.test(line)) {
      metadata = {};
      peaks = [];
      continue;
    }
    if (/^END IONS$/iu.test(line)) {
      if (metadata) spectra.push(msSpectrum(spectra.length, title, metadata, peaks));
      metadata = null;
      peaks = [];
      continue;
    }
    if (!metadata) continue;
    const equalIndex = line.indexOf("=");
    if (equalIndex > 0) {
      metadata[line.slice(0, equalIndex).trim()] = line.slice(equalIndex + 1).trim();
      continue;
    }
    const pair = parseNumberPair(line);
    if (pair) peaks.push({ x: pair[0], y: pair[1] });
  }
  return spectrumFile("mgf", title, spectra, {});
}

function parseMspFile(title: string, content: string): SpectrumFile {
  const spectra: SpectrumDocument[] = [];
  let metadata: Record<string, string> = {};
  let peaks: SpectrumPeak[] = [];
  const flush = () => {
    if (Object.keys(metadata).length > 0 || peaks.length > 0) {
      spectra.push(msSpectrum(spectra.length, title, metadata, peaks));
    }
    metadata = {};
    peaks = [];
  };
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    const field = line.match(/^([^:]+):\s*(.*)$/u);
    if (field) {
      metadata[field[1].trim()] = field[2].trim();
      continue;
    }
    for (const segment of line.split(";")) {
      const pair = parseNumberPair(segment.trim());
      if (pair) peaks.push({ x: pair[0], y: pair[1] });
    }
  }
  flush();
  return spectrumFile("msp", title, spectra, {});
}

function parseMzmlFile(title: string, content: string): SpectrumFile {
  const document = new DOMParser().parseFromString(content, "application/xml");
  const warnings: string[] = [];
  const spectra = Array.from(document.querySelectorAll("spectrum")).slice(0, 250).map((element, index) => {
    const metadata = xmlMetadata(element);
    const arrays = Array.from(element.querySelectorAll("binaryDataArray"));
    const mz = decodeMzmlArray(arrays.find((array) => hasCv(array, "MS:1000514")), warnings);
    const intensity = decodeMzmlArray(arrays.find((array) => hasCv(array, "MS:1000515")), warnings);
    return msSpectrum(index, title, {
      id: element.getAttribute("id") || `scan-${index + 1}`,
      ...metadata,
    }, zipPeaks(mz, intensity));
  }).filter((spectrum) => spectrum.peaks.length > 0);
  return { ...spectrumFile("mzml", title, spectra, {}), warnings };
}

function parseMzxmlFile(title: string, content: string): SpectrumFile {
  const document = new DOMParser().parseFromString(content, "application/xml");
  const warnings: string[] = [];
  const spectra = Array.from(document.querySelectorAll("scan")).slice(0, 250).map((element, index) => {
    const peaksElement = element.querySelector("peaks");
    const metadata = Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]));
    const precision = Number(peaksElement?.getAttribute("precision") || "32");
    const compressed = (peaksElement?.getAttribute("compressionType") || "none").toLowerCase() !== "none";
    const bytes = peaksElement?.textContent?.trim() ?? "";
    const values = compressed ? [] : decodeFloatArray(bytes, precision, "big", warnings);
    if (compressed) warnings.push("Compressed mzXML peaks are not decoded in this preview yet.");
    const peaks: SpectrumPeak[] = [];
    for (let valueIndex = 0; valueIndex + 1 < values.length; valueIndex += 2) {
      peaks.push({ x: values[valueIndex], y: values[valueIndex + 1] });
    }
    return msSpectrum(index, title, metadata, peaks);
  }).filter((spectrum) => spectrum.peaks.length > 0);
  return { ...spectrumFile("mzxml", title, spectra, {}), warnings };
}

function msSpectrum(index: number, title: string, metadata: Record<string, string>, peaks: SpectrumPeak[]): SpectrumDocument {
  return {
    id: metadata.id || metadata.TITLE || metadata.Name || `spectrum-${index + 1}`,
    title: metadata.TITLE || metadata.Name || metadata.id || `${title} #${index + 1}`,
    kind: inferMsKind(metadata),
    xLabel: "m/z",
    yLabel: "Intensity",
    xUnit: "m/z",
    peaks,
    metadata,
  };
}

function spectrumFile(format: SpectrumFormat, title: string, spectra: SpectrumDocument[], metadata: Record<string, string>): SpectrumFile {
  return { format, title, spectra, metadata, warnings: [] };
}

function inferMsKind(metadata: Record<string, string>): SpectrumDocument["kind"] {
  const msLevel = metadata.msLevel || metadata.MSLEVEL || metadata.MS_LEVEL;
  if (msLevel === "1") return "ms1";
  if (msLevel === "2" || metadata.PEPMASS || metadata.PRECURSORMZ || metadata.parentmass) return "ms2";
  return "unknown";
}

function parseNumberPair(line: string): [number, number] | null {
  const [left, right] = line.split(/[\s,]+/u);
  const x = Number(left);
  const y = Number(right);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function numericIfPossible(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && value.trim() !== "" ? number : value;
}

function xmlMetadata(element: Element) {
  const metadata: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) metadata[attribute.name] = attribute.value;
  for (const cv of Array.from(element.querySelectorAll("cvParam"))) {
    const name = cv.getAttribute("name");
    const value = cv.getAttribute("value");
    if (name && value) metadata[name] = value;
  }
  return metadata;
}

function hasCv(element: Element | undefined, accession: string) {
  return Boolean(element?.querySelector(`cvParam[accession="${accession}"]`));
}

function decodeMzmlArray(element: Element | undefined, warnings: string[]) {
  if (!element) return [];
  const compressed = hasCv(element, "MS:1000574");
  if (compressed) {
    warnings.push("Compressed mzML binary arrays are not decoded in this preview yet.");
    return [];
  }
  const precision = hasCv(element, "MS:1000523") ? 64 : 32;
  return decodeFloatArray(element.querySelector("binary")?.textContent?.trim() ?? "", precision, "little", warnings);
}

function decodeFloatArray(base64: string, precision: number, endian: "little" | "big", warnings: string[]) {
  if (!base64) return [];
  try {
    const binary = atob(base64.replace(/\s+/gu, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const view = new DataView(bytes.buffer);
    const values: number[] = [];
    const littleEndian = endian === "little";
    const step = precision === 64 ? 8 : 4;
    for (let offset = 0; offset + step <= bytes.byteLength; offset += step) {
      values.push(precision === 64 ? view.getFloat64(offset, littleEndian) : view.getFloat32(offset, littleEndian));
    }
    return values.filter(Number.isFinite);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
    return [];
  }
}

function zipPeaks(x: number[], y: number[]) {
  return x.slice(0, y.length).map((value, index) => ({ x: value, y: y[index] })).filter((peak) => (
    Number.isFinite(peak.x) && Number.isFinite(peak.y)
  ));
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(36);
}
