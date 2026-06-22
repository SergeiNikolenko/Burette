import { existsSync, readFileSync, readdirSync, statSync, type Dirent, type Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { ViteDevServer } from "vite";

import { sendJson, sendJsonError } from "./http";

type BrowserDevNumpyArraySummary = {
  name: string;
  dtype: string;
  shape: number[];
  valueCount: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  nanCount: number;
  values: Array<number | null>;
  unsupported: string | null;
};

type BrowserDevFoldingArtifact = {
  path: string;
  title: string;
  extension: string;
  kind: string;
  byteCount: number;
};

type BrowserDevFoldingMetric = {
  key: string;
  label: string;
  value: number;
  formatted: string;
};

type BrowserDevFoldingModel = {
  id: string;
  title: string;
  backend: string;
  seed: number | null;
  modelIndex: number | null;
  structurePath: string;
  structureTitle: string;
  metrics: BrowserDevFoldingMetric[];
  plddtProfile: null | {
    label: string;
    path: string;
    values: number[];
    min: number;
    max: number;
    mean: number;
  };
  matrixPreview: null | {
    kind: string;
    label: string;
    path: string;
    shape: number[];
    values: Array<Array<number | null>>;
    xLabels: string[];
    yLabels: string[];
    min: number | null;
    max: number | null;
    mean: number | null;
  };
  artifacts: BrowserDevFoldingArtifact[];
};

type BrowserDevFoldingResultBundle = {
  rootPath: string;
  title: string;
  source: string;
  models: BrowserDevFoldingModel[];
  artifacts: BrowserDevFoldingArtifact[];
  warnings: string[];
};

type BrowserDevFoldingResultRouteOptions = {
  isDevFileReadAllowed: (path: string) => boolean | string;
};

export function registerBrowserDevFoldingResultRoute(
  server: ViteDevServer,
  options: BrowserDevFoldingResultRouteOptions,
) {
  server.middlewares.use("/__burette/folding-result", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const url = new URL(req.url || "", "http://127.0.0.1");
      const path = url.searchParams.get("path");
      if (!path) {
        sendJson(res, 400, { error: "Missing path" });
        return;
      }
      const filePath = resolve(path);
      if (!options.isDevFileReadAllowed(filePath)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }
      sendJson(res, 200, readBrowserDevFoldingResultBundle(filePath), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}

export function isNumpyArtifactExtension(extension: string) {
  return extension === "npy" || extension === "npz";
}

export function numpyArtifactTextSummary(path: string, bytes: Buffer, byteCount: number) {
  const arrays = parseNumpyArrays(path, bytes, 4096);
  const title = fileExtension(path) === "npz" ? "NumPy NPZ archive" : "NumPy NPY array";
  const lines = [
    title,
    "",
    `File: ${path}`,
    `Size: ${byteCount} bytes`,
    "",
    "| Array | Shape | Dtype | Values | Min | Max | Mean | NaN | Notes |",
    "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const array of arrays) {
    lines.push(`| ${markdownCell(array.name)} | ${markdownCell(formatNumpyShape(array.shape))} | ${markdownCell(array.dtype)} | ${array.valueCount} | ${formatOptionalNumber(array.min)} | ${formatOptionalNumber(array.max)} | ${formatOptionalNumber(array.mean)} | ${array.nanCount} | ${markdownCell(array.unsupported || "")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function parseNumpyArrays(path: string, bytes: Buffer, maxValues: number): BrowserDevNumpyArraySummary[] {
  const extension = fileExtension(path);
  if (extension === "npy") return [parseNpyArray(fileTitle(path), bytes, maxValues)];
  if (extension !== "npz") throw new Error(`${path} is not a NumPy artifact`);
  const arrays: BrowserDevNumpyArraySummary[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    if (bufferHasMagic(bytes, offset, "PK\u0001\u0002") || bufferHasMagic(bytes, offset, "PK\u0005\u0006")) break;
    if (!bufferHasMagic(bytes, offset, "PK\u0003\u0004")) throw new Error(`invalid NPZ local file header at byte ${offset}`);
    if (offset + 30 > bytes.length) throw new Error("truncated NPZ local file header");
    const flags = bytes.readUInt16LE(offset + 6);
    const compression = bytes.readUInt16LE(offset + 8);
    const rawCompressedSize = bytes.readUInt32LE(offset + 18);
    const rawUncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const dataStart = nameEnd + extraLength;
    if (nameEnd > bytes.length || dataStart > bytes.length) throw new Error("truncated NPZ entry metadata");
    const extra = bytes.subarray(nameEnd, dataStart);
    const compressedSize = zipEntryCompressedSize(extra, rawUncompressedSize, rawCompressedSize);
    const dataEnd = dataStart + compressedSize;
    if ((flags & 0x08) !== 0) throw new Error("NPZ entries with data descriptors are not supported");
    if (dataEnd > bytes.length) throw new Error("truncated NPZ entry data");
    const name = bytes.subarray(nameStart, nameEnd).toString("utf8");
    if (name.endsWith(".npy")) {
      const compressed = bytes.subarray(dataStart, dataEnd);
      const entryBytes = compression === 0
        ? compressed
        : compression === 8
          ? inflateRawSync(compressed)
          : null;
      if (entryBytes) {
        arrays.push(parseNpyArray(name.replace(/\.npy$/u, ""), entryBytes, maxValues));
      } else {
        arrays.push({
          name,
          dtype: "",
          shape: [],
          valueCount: 0,
          min: null,
          max: null,
          mean: null,
          nanCount: 0,
          values: [],
          unsupported: `ZIP compression method ${compression} is not supported`,
        });
      }
    }
    offset = dataEnd;
  }
  if (!arrays.length) throw new Error("NPZ archive contains no .npy arrays");
  return arrays;
}

function parseNpyArray(name: string, bytes: Buffer, maxValues: number): BrowserDevNumpyArraySummary {
  if (bytes.length < 10 || bytes.subarray(0, 6).toString("latin1") !== "\x93NUMPY") {
    throw new Error("invalid NPY magic header");
  }
  const major = bytes[6];
  const headerLength = major === 1 ? bytes.readUInt16LE(8) : major === 2 || major === 3 ? bytes.readUInt32LE(8) : null;
  const headerStart = major === 1 ? 10 : 12;
  if (headerLength === null) throw new Error(`unsupported NPY version ${major}.${bytes[7]}`);
  const headerEnd = headerStart + headerLength;
  if (headerEnd > bytes.length) throw new Error("truncated NPY header");
  const header = bytes.subarray(headerStart, headerEnd).toString("latin1");
  const dtype = header.match(/['"]descr['"]\s*:\s*['"]([^'"]+)['"]/u)?.[1] || "";
  const shapeText = header.match(/['"]shape['"]\s*:\s*\(([^)]*)\)/u)?.[1] || "";
  const fortranOrder = /['"]fortran_order['"]\s*:\s*True/u.test(header);
  const shape = shapeText.split(",").map((part) => Number.parseInt(part.trim(), 10)).filter((value) => Number.isFinite(value));
  const valueCount = shape.length ? shape.reduce((acc, value) => acc * value, 1) : 1;
  const parsedDtype = parseNumpyDtype(dtype);
  if (!parsedDtype) {
    return numpyUnsupportedSummary(name, dtype, shape, valueCount, "structured, object, complex, or string dtype is not previewed");
  }
  if (fortranOrder && shape.length > 1) {
    return numpyUnsupportedSummary(name, dtype, shape, valueCount, "Fortran-order arrays are summarized as metadata only");
  }
  const availableValues = Math.min(valueCount, Math.floor((bytes.length - headerEnd) / parsedDtype.size));
  const values: Array<number | null> = [];
  let min: number | null = null;
  let max: number | null = null;
  let sum = 0;
  let count = 0;
  let nanCount = 0;
  for (let index = 0; index < availableValues; index += 1) {
    const value = readNumpyDtypeValue(bytes, headerEnd + index * parsedDtype.size, parsedDtype);
    if (Number.isFinite(value)) {
      min = min === null ? value : Math.min(min, value);
      max = max === null ? value : Math.max(max, value);
      sum += value;
      count += 1;
      if (values.length < maxValues) values.push(value);
    } else {
      nanCount += 1;
      if (values.length < maxValues) values.push(null);
    }
  }
  return {
    name,
    dtype,
    shape,
    valueCount,
    min,
    max,
    mean: count > 0 ? sum / count : null,
    nanCount,
    values,
    unsupported: availableValues < valueCount ? "array payload is shorter than the declared shape" : null,
  };
}

function numpyUnsupportedSummary(name: string, dtype: string, shape: number[], valueCount: number, unsupported: string): BrowserDevNumpyArraySummary {
  return { name, dtype, shape, valueCount, min: null, max: null, mean: null, nanCount: 0, values: [], unsupported };
}

function parseNumpyDtype(dtype: string): null | { endian: "little" | "big" | "native"; kind: string; size: number } {
  if (!dtype || dtype.startsWith("[") || /[OSUc]/u.test(dtype)) return null;
  let endian: "little" | "big" | "native" = "native";
  let offset = 0;
  if (dtype[0] === "<") {
    endian = "little";
    offset = 1;
  } else if (dtype[0] === ">") {
    endian = "big";
    offset = 1;
  } else if (dtype[0] === "|" || dtype[0] === "=") {
    offset = 1;
  }
  const kind = dtype[offset];
  const size = kind === "?" ? 1 : Number.parseInt(dtype.slice(offset + 1), 10);
  if (!kind || !Number.isFinite(size) || size <= 0 || !["f", "i", "u", "b", "?"].includes(kind)) return null;
  return { endian, kind, size };
}

function readNumpyDtypeValue(bytes: Buffer, offset: number, dtype: { endian: "little" | "big" | "native"; kind: string; size: number }) {
  const little = dtype.endian !== "big";
  if (dtype.kind === "f" && dtype.size === 4) return little ? bytes.readFloatLE(offset) : bytes.readFloatBE(offset);
  if (dtype.kind === "f" && dtype.size === 8) return little ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset);
  if (dtype.kind === "i" && dtype.size === 1) return bytes.readInt8(offset);
  if (dtype.kind === "i" && dtype.size === 2) return little ? bytes.readInt16LE(offset) : bytes.readInt16BE(offset);
  if (dtype.kind === "i" && dtype.size === 4) return little ? bytes.readInt32LE(offset) : bytes.readInt32BE(offset);
  if (dtype.kind === "i" && dtype.size === 8) return Number(little ? bytes.readBigInt64LE(offset) : bytes.readBigInt64BE(offset));
  if (dtype.kind === "u" && dtype.size === 1) return bytes.readUInt8(offset);
  if (dtype.kind === "u" && dtype.size === 2) return little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  if (dtype.kind === "u" && dtype.size === 4) return little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  if (dtype.kind === "u" && dtype.size === 8) return Number(little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset));
  if (dtype.kind === "b" || dtype.kind === "?") return bytes.readUInt8(offset) === 0 ? 0 : 1;
  return Number.NaN;
}

function bufferHasMagic(bytes: Buffer, offset: number, magic: string) {
  return bytes.subarray(offset, offset + magic.length).toString("latin1") === magic;
}

function zipEntryCompressedSize(extra: Buffer, rawUncompressedSize: number, rawCompressedSize: number) {
  if (rawCompressedSize !== 0xffffffff) return rawCompressedSize;
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const tag = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    const dataStart = offset + 4;
    const dataEnd = dataStart + size;
    if (dataEnd > extra.length) throw new Error("truncated NPZ extra field");
    if (tag === 0x0001) {
      let cursor = dataStart;
      if (rawUncompressedSize === 0xffffffff) cursor += 8;
      const compressedSize = Number(extra.readBigUInt64LE(cursor));
      if (!Number.isSafeInteger(compressedSize)) throw new Error("NPZ entry is too large to preview");
      return compressedSize;
    }
    offset = dataEnd;
  }
  throw new Error("NPZ entry uses ZIP64 sizes but has no ZIP64 extra field");
}

function formatNumpyShape(shape: number[]) {
  return shape.length ? `(${shape.join(", ")})` : "()";
}

function markdownCell(value: string) {
  return value.replace(/\|/gu, "\\|");
}

function formatOptionalNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000 || (value !== 0 && Math.abs(value) < 0.001)) return value.toExponential(3);
  return value.toFixed(4);
}

function readBrowserDevFoldingResultBundle(inputPath: string): BrowserDevFoldingResultBundle {
  const roots = candidateFoldingRoots(inputPath);
  for (const [distance, root] of roots.entries()) {
    const bundle = scanBrowserDevFoldingRoot(root, inputPath);
    if (!browserDevFoldingBundleHasContent(bundle)) continue;
    if (distance === 0 || browserDevFoldingBundleReferencesInput(bundle, inputPath)) return bundle;
  }
  return emptyBrowserDevFoldingBundle(inputPath, inputPath, []);
}

function browserDevFoldingBundleHasContent(bundle: BrowserDevFoldingResultBundle) {
  return bundle.models.length > 0 || bundle.artifacts.length > 0;
}

function browserDevFoldingBundleReferencesInput(bundle: BrowserDevFoldingResultBundle, inputPath: string) {
  return bundle.models.some((model) => model.structurePath === inputPath)
    || bundle.artifacts.some((artifact) => artifact.path === inputPath)
    || bundle.models.some((model) => model.artifacts.some((artifact) => artifact.path === inputPath));
}

function scanBrowserDevFoldingRoot(root: string, inputPath: string): BrowserDevFoldingResultBundle {
  const files: Array<{ path: string; title: string; extension: string; byteCount: number }> = [];
  collectBrowserDevFoldingFiles(root, 0, files);
  const foldingEntries = files.filter((entry) => foldingArtifactKind(entry) !== null);
  if (!foldingEntries.length) return emptyBrowserDevFoldingBundle(root, inputPath, []);
  const structures = files.filter((entry) => isFoldingStructureExtension(entry.extension));
  const warnings: string[] = [];
  const models: BrowserDevFoldingModel[] = [];
  structures.forEach((structure, index) => {
    const modelIndex = modelIndexForPath(structure.path);
    const seed = seedForPath(structure.path);
    const artifacts = matchingBrowserDevFoldingArtifacts(structure, modelIndex, structures, foldingEntries);
    if (!artifacts.length) return;
    const outputs = browserDevModelOutputsForArtifacts(artifacts);
    warnings.push(...outputs.warnings);
    const backend = backendForBrowserDevFoldingModel(structure, artifacts, root);
    models.push({
      id: `folding:${structure.path}:${index}`,
      title: browserDevModelTitle(backend, index, modelIndex, seed),
      backend,
      seed,
      modelIndex,
      structurePath: structure.path,
      structureTitle: structure.title,
      metrics: outputs.metrics,
      plddtProfile: outputs.plddtProfile,
      matrixPreview: outputs.matrixPreview,
      artifacts: artifacts.map(browserDevFoldingArtifact),
    });
  });
  const artifacts = foldingEntries.map(browserDevFoldingArtifact);
  return {
    rootPath: root,
    title: fileTitle(root),
    source: browserDevFoldingSource(root, models, artifacts),
    models,
    artifacts,
    warnings,
  };
}

function browserDevModelOutputsForArtifacts(artifacts: Array<{ path: string; title: string; extension: string; byteCount: number }>) {
  const metrics: BrowserDevFoldingMetric[] = [];
  const metricKeys = new Set<string>();
  let plddtProfile: BrowserDevFoldingModel["plddtProfile"] = null;
  let matrixPreview: BrowserDevFoldingModel["matrixPreview"] = null;
  const warnings: string[] = [];
  for (const artifact of artifacts) {
    if (artifact.extension === "json") {
      try {
        const value = JSON.parse(readFileSync(artifact.path, "utf8"));
        collectBrowserDevJsonMetrics(value, "", metrics, metricKeys);
        plddtProfile ||= browserDevPlddtProfileForJson(value, artifact);
        const preview = matrixPreview ? null : browserDevMatrixPreviewForJson(value, artifact);
        if (preview) {
          addBrowserDevMatrixMetric(preview, metrics, metricKeys);
          matrixPreview = preview;
        }
      } catch (_) {
        warnings.push(`Could not parse ${artifact.title}`);
      }
      continue;
    }
    if (artifact.extension === "html" || artifact.extension === "htm") {
      if (!matrixPreview) {
        const preview = browserDevMatrixPreviewForAbcfoldHtml(artifact);
        if (preview) {
          addBrowserDevMatrixMetric(preview, metrics, metricKeys);
          matrixPreview = preview;
        }
      }
      continue;
    }
    if (!isNumpyArtifactExtension(artifact.extension)) continue;
    try {
      for (const array of parseNumpyArrays(artifact.path, readFileSync(artifact.path), 1_000_000)) {
        addBrowserDevArrayMetrics(array, artifact, metrics, metricKeys);
        plddtProfile ||= browserDevPlddtProfileForArray(array, artifact);
        matrixPreview ||= browserDevMatrixPreviewForArray(array, artifact);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { metrics, plddtProfile, matrixPreview, warnings };
}

function collectBrowserDevJsonMetrics(value: unknown, prefix: string, metrics: BrowserDevFoldingMetric[], keys: Set<string>) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectBrowserDevJsonMetrics(child, prefix ? `${prefix}.${key}` : key, metrics, keys);
    }
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  const key = normalizeFoldingMetricKey(prefix);
  if (isBrowserDevConfidenceMetric(key)) addBrowserDevMetric(metrics, keys, key, browserDevMetricLabel(key), value);
}

function addBrowserDevMatrixMetric(preview: NonNullable<BrowserDevFoldingModel["matrixPreview"]>, metrics: BrowserDevFoldingMetric[], keys: Set<string>) {
  if (preview.mean === null) return;
  if (preview.kind === "pae") addBrowserDevMetric(metrics, keys, "pae_mean", "Mean PAE", preview.mean);
  if (preview.kind === "pde") addBrowserDevMetric(metrics, keys, "pde_mean", "Mean PDE", preview.mean);
}

function addBrowserDevArrayMetrics(array: BrowserDevNumpyArraySummary, artifact: { title: string }, metrics: BrowserDevFoldingMetric[], keys: Set<string>) {
  const name = normalizeFoldingMetricKey(array.name);
  const path = normalizeFoldingMetricKey(artifact.title);
  if (array.mean === null) return;
  if (name.includes("plddt") || path.includes("plddt")) {
    addBrowserDevMetric(metrics, keys, "plddt_mean", "Mean pLDDT", array.mean <= 1.5 ? array.mean * 100 : array.mean);
  } else if (name.includes("pae") || path.includes("pae")) {
    addBrowserDevMetric(metrics, keys, "pae_mean", "Mean PAE", array.mean);
  } else if (name.includes("pde") || path.includes("pde")) {
    addBrowserDevMetric(metrics, keys, "pde_mean", "Mean PDE", array.mean);
  }
}

function browserDevPlddtProfileForArray(array: BrowserDevNumpyArraySummary, artifact: { path: string; title: string }) {
  const name = normalizeFoldingMetricKey(array.name);
  const path = normalizeFoldingMetricKey(artifact.title);
  if (!(name.includes("plddt") || path.includes("plddt")) || array.shape.length !== 1) return null;
  const scale = (array.max ?? 0) <= 1.5;
  const values = array.values.filter((value): value is number => value !== null).map((value) => scale ? value * 100 : value);
  const stats = finiteNumberStats(values);
  if (!stats) return null;
  return { label: "pLDDT", path: artifact.path, values, min: stats.min, max: stats.max, mean: stats.mean };
}

function browserDevPlddtProfileForJson(value: unknown, artifact: { path: string }) {
  const payload = browserDevJsonObjectPayload(value);
  const rawValues = payload ? browserDevNumericVector(payload.plddt ?? payload.plddts ?? payload.predicted_lddt) : null;
  if (!rawValues) return null;
  const scale = Math.max(...rawValues) <= 1.5;
  const values = rawValues.map((value) => scale ? value * 100 : value);
  const stats = finiteNumberStats(values);
  if (!stats) return null;
  return { label: "pLDDT", path: artifact.path, values, min: stats.min, max: stats.max, mean: stats.mean };
}

function browserDevMatrixPreviewForArray(array: BrowserDevNumpyArraySummary, artifact: { path: string; title: string }) {
  if (array.shape.length !== 2) return null;
  const name = normalizeFoldingMetricKey(array.name);
  const path = normalizeFoldingMetricKey(artifact.title);
  const kind = name.includes("pae") || path.includes("pae") ? "pae" : name.includes("pde") || path.includes("pde") ? "pde" : null;
  if (!kind) return null;
  const rows = array.shape[0];
  const cols = array.shape[1];
  if (!rows || !cols || rows * cols > array.values.length) return null;
  const rowCount = Math.min(rows, 72);
  const colCount = Math.min(cols, 72);
  const values: Array<Array<number | null>> = [];
  for (let row = 0; row < rowCount; row += 1) {
    const sourceRow = Math.floor(row * rows / rowCount);
    const previewRow: Array<number | null> = [];
    for (let col = 0; col < colCount; col += 1) {
      const sourceCol = Math.floor(col * cols / colCount);
      previewRow.push(array.values[sourceRow * cols + sourceCol] ?? null);
    }
    values.push(previewRow);
  }
  return { kind, label: kind.toUpperCase(), path: artifact.path, shape: array.shape, values, xLabels: [], yLabels: [], min: array.min, max: array.max, mean: array.mean };
}

function browserDevMatrixPreviewForJson(value: unknown, artifact: { path: string; title: string }) {
  const payload = browserDevJsonObjectPayload(value);
  const artifactKey = normalizeFoldingMetricKey(artifact.title);
  const matrixValue = payload?.pae ?? payload?.predicted_aligned_error ?? (artifactKey.includes("pae") || artifactKey.includes("predicted_aligned_error") ? value : null);
  const matrix = browserDevNumericMatrix(matrixValue);
  if (!matrix) return null;
  return browserDevMatrixPreviewFromMatrix("pae", "PAE", artifact.path, matrix, payload ? browserDevTokenLabelsForJson(payload, matrix.length) : null);
}

function browserDevMatrixPreviewForAbcfoldHtml(artifact: { path: string; title: string }) {
  if (!artifact.title.toLowerCase().includes("pae")) return null;
  const sessionText = browserDevHtmlJsonScriptContent(readFileSync(artifact.path, "utf8"), "session-data");
  if (!sessionText) return null;
  const session = JSON.parse(sessionText);
  const scoresContent = browserDevJsonObjectPayload(session)?.scoresFile;
  if (scoresContent && typeof scoresContent === "object" && !Array.isArray(scoresContent) && typeof scoresContent.content === "string") {
    return browserDevMatrixPreviewForJson(JSON.parse(scoresContent.content), artifact);
  }
  return browserDevMatrixPreviewForJson(session, artifact);
}

function browserDevMatrixPreviewFromMatrix(
  kind: string,
  label: string,
  path: string,
  matrix: Array<Array<number | null>>,
  labels: string[] | null,
) {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  if (!rows || !cols) return null;
  const rowCount = Math.min(rows, 72);
  const colCount = Math.min(cols, 72);
  const values: Array<Array<number | null>> = [];
  const xLabels: string[] = [];
  const yLabels: string[] = [];
  for (let col = 0; col < colCount; col += 1) {
    const sourceCol = Math.floor(col * cols / colCount);
    xLabels.push(labels?.[sourceCol] ?? String(sourceCol + 1));
  }
  for (let row = 0; row < rowCount; row += 1) {
    const sourceRow = Math.floor(row * rows / rowCount);
    yLabels.push(labels?.[sourceRow] ?? String(sourceRow + 1));
    const previewRow: Array<number | null> = [];
    for (let col = 0; col < colCount; col += 1) {
      const sourceCol = Math.floor(col * cols / colCount);
      previewRow.push(matrix[sourceRow]?.[sourceCol] ?? null);
    }
    values.push(previewRow);
  }
  const stats = finiteNumberStats(matrix.flat().filter((value): value is number => value !== null));
  if (!stats) return null;
  return { kind, label, path, shape: [rows, cols], values, xLabels, yLabels, min: stats.min, max: stats.max, mean: stats.mean };
}

function browserDevJsonObjectPayload(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (Array.isArray(value)) {
    const object = value.find((item) => item && typeof item === "object" && !Array.isArray(item));
    return object ? object as Record<string, unknown> : null;
  }
  return null;
}

function browserDevNumericVector(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const output: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) return null;
    output.push(item);
  }
  return output;
}

function browserDevNumericMatrix(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const first = value[0];
  if (!Array.isArray(first) || !first.length) return null;
  const colCount = first.length;
  const matrix: Array<Array<number | null>> = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== colCount) return null;
    const outputRow: Array<number | null> = [];
    for (const item of row) {
      if (item === null) {
        outputRow.push(null);
      } else if (typeof item === "number" && Number.isFinite(item) && item >= 0) {
        outputRow.push(item);
      } else {
        return null;
      }
    }
    matrix.push(outputRow);
  }
  return matrix;
}

function browserDevTokenLabelsForJson(payload: Record<string, unknown>, expectedLength: number) {
  const residueLabels = browserDevJsonLabelArray(payload.token_res_ids ?? payload.residue_ids ?? payload.residue_index);
  if (!residueLabels || residueLabels.length !== expectedLength) return null;
  const chainLabels = browserDevJsonLabelArray(payload.token_chain_ids ?? payload.chain_ids);
  if (!chainLabels || chainLabels.length !== expectedLength) return residueLabels;
  return residueLabels.map((residue, index) => `${chainLabels[index]}:${residue}`);
}

function browserDevJsonLabelArray(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item === "string") labels.push(item);
    else if (typeof item === "number" && Number.isFinite(item)) labels.push(String(item));
    else return null;
  }
  return labels;
}

function browserDevHtmlJsonScriptContent(html: string, scriptId: string) {
  const idPosition = html.indexOf(`id="${scriptId}"`);
  if (idPosition < 0) return null;
  const scriptStart = html.lastIndexOf("<script", idPosition);
  if (scriptStart < 0) return null;
  const contentStart = html.indexOf(">", scriptStart);
  if (contentStart < 0) return null;
  const contentEnd = html.indexOf("</script>", contentStart + 1);
  if (contentEnd < 0) return null;
  return html.slice(contentStart + 1, contentEnd).trim();
}

function matchingBrowserDevFoldingArtifacts(
  structure: { path: string },
  modelIndex: number | null,
  structures: Array<{ path: string }>,
  artifacts: Array<{ path: string }>,
) {
  const parent = dirname(structure.path);
  const stem = fileTitle(structure.path).replace(/\.[^.]+$/u, "").toLowerCase();
  return artifacts.filter((artifact) => {
    const lower = artifact.path.toLowerCase();
    return structures.length === 1
      || dirname(artifact.path) === parent
      || (modelIndex !== null && filenameMentionsModel(lower, modelIndex))
      || (stem && lower.includes(stem));
  });
}

function collectBrowserDevFoldingFiles(root: string, depth: number, files: Array<{ path: string; title: string; extension: string; byteCount: number }>) {
  if (depth > 6 || files.length >= 5000 || !existsSync(root)) return;
  let dirents: Dirent[];
  try {
    dirents = readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const dirent of dirents) {
    if (files.length >= 5000) return;
    const path = join(root, dirent.name);
    if (dirent.isDirectory()) {
      collectBrowserDevFoldingFiles(path, depth + 1, files);
      continue;
    }
    if (!dirent.isFile()) continue;
    let info: Stats;
    try {
      info = statSync(path);
    } catch (_) {
      continue;
    }
    files.push({ path, title: fileTitle(path), extension: fileExtension(path), byteCount: info.size });
  }
}

function candidateFoldingRoots(inputPath: string) {
  const info = statSync(inputPath);
  let root = info.isDirectory() ? inputPath : dirname(inputPath);
  const roots = [root];
  for (let index = 0; index < 6; index += 1) {
    const parent = dirname(root);
    if (!parent || parent === root) break;
    root = parent;
    roots.push(root);
  }
  return roots;
}

function foldingArtifactKind(entry: { title: string; extension: string }) {
  const lower = entry.title.toLowerCase();
  if (entry.extension === "json" && (lower.includes("confidence") || lower.includes("score"))) return "confidence";
  if (entry.extension === "json" && lower.includes("affinity")) return "affinity";
  if (entry.extension === "json") return "metadata";
  if ((entry.extension === "npz" || entry.extension === "npy") && lower.includes("plddt")) return "plddt";
  if ((entry.extension === "npz" || entry.extension === "npy") && lower.includes("pae")) return "pae";
  if ((entry.extension === "npz" || entry.extension === "npy") && lower.includes("pde")) return "pde";
  if (entry.extension === "npz" || entry.extension === "npy") return "array";
  if (entry.extension === "pkl" || entry.extension === "pickle") return "pickle";
  if (entry.extension === "pml" || entry.extension === "pse") return "pymol";
  if (entry.extension === "html" || entry.extension === "htm") return "report";
  return null;
}

function browserDevFoldingArtifact(entry: { path: string; title: string; extension: string; byteCount: number }): BrowserDevFoldingArtifact {
  return {
    path: entry.path,
    title: entry.title,
    extension: entry.extension,
    kind: foldingArtifactKind(entry) || "artifact",
    byteCount: entry.byteCount,
  };
}

function isFoldingStructureExtension(extension: string) {
  return ["pdb", "cif", "mmcif", "mcif", "bcif"].includes(extension);
}

function modelIndexForPath(path: string) {
  return digitsAfterAny(path.toLowerCase(), ["model_idx_", "model_idx-", "model_", "model-", "sample_", "sample-"]);
}

function seedForPath(path: string) {
  return digitsAfterAny(path.toLowerCase(), ["seed_", "seed-"]);
}

function digitsAfterAny(value: string, needles: string[]) {
  for (const needle of needles) {
    const index = value.indexOf(needle);
    if (index < 0) continue;
    const match = value.slice(index + needle.length).match(/^\d+/u);
    if (match) return Number.parseInt(match[0], 10);
  }
  return null;
}

function filenameMentionsModel(lowerPath: string, index: number) {
  return [`model_idx_${index}`, `model_idx-${index}`, `model_${index}`, `model-${index}`, `sample_${index}`, `sample-${index}`]
    .some((needle) => lowerPath.includes(needle));
}

function backendForBrowserDevFoldingModel(structure: { path: string }, artifacts: Array<{ path: string }>, root: string) {
  const combined = [structure.path, ...artifacts.map((artifact) => artifact.path), root].join("\n").toLowerCase();
  if (combined.includes("boltz") || combined.includes("affinity_")) return "Boltz";
  if (combined.includes("chai") || combined.includes("model_idx")) return "Chai-1";
  if (combined.includes("protenix")) return "Protenix";
  if (combined.includes("openfold")) return "OpenFold";
  if (combined.includes("alphafold") || combined.includes("seed-") || combined.includes("summary_confidences")) return "AlphaFold3";
  return "Folding";
}

function browserDevModelTitle(backend: string, ordinal: number, modelIndex: number | null, seed: number | null) {
  const parts = [backend, modelIndex === null ? `model ${ordinal + 1}` : `model ${modelIndex}`];
  if (seed !== null) parts.push(`seed ${seed}`);
  return parts.join(" / ");
}

function browserDevFoldingSource(root: string, models: BrowserDevFoldingModel[], artifacts: BrowserDevFoldingArtifact[]) {
  const lower = root.toLowerCase();
  if (lower.includes("abcfold")) return "ABCFold result bundle";
  const backends = Array.from(new Set(models.map((model) => model.backend))).filter((backend) => backend !== "Folding");
  if (backends.length) return `${backends.join(" + ")} folding output`;
  if (artifacts.some((artifact) => artifact.kind === "affinity")) return "Boltz-style folding output";
  return "Folding result bundle";
}

function addBrowserDevMetric(metrics: BrowserDevFoldingMetric[], keys: Set<string>, key: string, label: string, value: number) {
  if (!Number.isFinite(value) || keys.has(key)) return;
  keys.add(key);
  metrics.push({ key, label, value, formatted: formatBrowserDevMetricValue(key, value) });
}

function isBrowserDevConfidenceMetric(key: string) {
  return [
    "ptm", "iptm", "ranking_score", "ranking_confidence", "confidence_score", "fraction_disordered",
    "has_clash", "complex_plddt", "complex_iplddt", "complex_pde", "complex_ipde",
    "affinity_pred_value", "affinity_probability_binary", "affinity_pred_probability",
  ].includes(key) || key.includes("plddt") || key.includes("iptm") || key.includes("ptm") || key.includes("affinity");
}

function browserDevMetricLabel(key: string) {
  const labels: Record<string, string> = {
    ptm: "pTM",
    iptm: "ipTM",
    ranking_score: "Ranking",
    ranking_confidence: "Ranking confidence",
    confidence_score: "Confidence",
    fraction_disordered: "Disordered fraction",
    complex_plddt: "Complex pLDDT",
    complex_iplddt: "Complex ipLDDT",
    complex_pde: "Complex PDE",
    complex_ipde: "Complex ipDE",
    affinity_pred_value: "Affinity",
    affinity_probability_binary: "Affinity probability",
    affinity_pred_probability: "Affinity probability",
  };
  return labels[key] || key.split("_").filter(Boolean).map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`).join(" ");
}

function formatBrowserDevMetricValue(key: string, value: number) {
  if ((key.includes("probability") || key.includes("confidence") || key.includes("fraction")) && value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
  if (key.includes("plddt")) return value.toFixed(1);
  if (Math.abs(value) >= 1000 || (value !== 0 && Math.abs(value) < 0.001)) return value.toExponential(3);
  return value.toFixed(3);
}

function finiteNumberStats(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  return { min, max, mean };
}

function normalizeFoldingMetricKey(value: string) {
  const lower = value.toLowerCase().replace(/\.(npy|npz|json)$/u, "");
  return (lower.split(".").pop() || lower).replace(/[- /]/gu, "_");
}

function emptyBrowserDevFoldingBundle(root: string, inputPath: string, warnings: string[]): BrowserDevFoldingResultBundle {
  return {
    rootPath: root,
    title: fileTitle(inputPath),
    source: "Folding result bundle",
    models: [],
    artifacts: [],
    warnings,
  };
}

function fileExtension(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mae.gz")) return "maegz";
  const index = lower.lastIndexOf(".");
  return index >= 0 ? lower.slice(index + 1) : "";
}

function fileTitle(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "Text file";
}
