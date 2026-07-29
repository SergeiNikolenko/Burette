import { createHash } from "node:crypto";
import { mkdir, open as openFile, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ViteDevServer } from "vite";

import type { BrowserDevFileScan, BrowserDevFileScanLimits } from "./file-discovery";
import { readJsonBody, sendJson, sendJsonError } from "./http";

type BrowserDevFileRoutesOptions = {
  collectDefaultDevFiles: () => Promise<string[]>;
  collectDevFiles: (
    path: string,
    files: string[],
    limits?: Partial<BrowserDevFileScanLimits>,
  ) => Promise<BrowserDevFileScan>;
  devFileExtensions: Set<string>;
  devFileSizeLimit: number;
  fileExtension: (path: string) => string;
  fileTitle: (path: string) => string;
  isDevFileReadAllowed: (path: string) => boolean | string;
  isNumpyArtifactExtension: (extension: string) => boolean;
  imageMimeTypeForExtension: (extension: string) => string | null;
  languageForTextExtension: (extension: string) => string;
  looksBinary: (bytes: Buffer) => boolean;
  molecularBinaryArtifactSummary: (path: string, byteCount: number) => string;
  molecularBinaryMetadataExtensions: Set<string>;
  numpyArtifactTextSummary: (path: string, bytes: Buffer, byteCount: number) => string;
  readableTextBytes: (bytes: Buffer, extension: string) => Buffer;
  resolveStructureFileBundle: (path: string) => unknown;
  textFileReadLimit: (value: string | null) => number;
};

const IMAGE_PREVIEW_READ_LIMIT = 24 * 1024 * 1024;

export function registerBrowserDevFileDiscoveryRoute(server: ViteDevServer, options: BrowserDevFileRoutesOptions) {
  server.middlewares.use("/__burette/dev-files", async (req, res) => {
    try {
      const url = new URL(req.url || "", "http://127.0.0.1");
      const root = url.searchParams.get("root");
      let files: string[];
      let scan: BrowserDevFileScan | null = null;
      if (root) {
        const rootPath = resolve(root);
        if (!options.isDevFileReadAllowed(rootPath)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        files = [];
        scan = await options.collectDevFiles(rootPath, files, {
          maxDirectories: positiveScanLimit(url.searchParams.get("maxDirectories")),
          maxEntries: positiveScanLimit(url.searchParams.get("maxEntries")),
          maxFiles: positiveScanLimit(url.searchParams.get("maxFiles")),
        });
        files = Array.from(new Set(files)).sort((left, right) => left.localeCompare(right));
      } else {
        files = await options.collectDefaultDevFiles();
      }
      sendJson(res, 200, {
        files,
        truncated: scan?.truncated ?? false,
        scannedEntries: scan?.scannedEntries ?? files.length,
        scannedDirectories: scan?.scannedDirectories ?? 0,
      });
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}

export function registerBrowserDevFileContentRoutes(server: ViteDevServer, options: BrowserDevFileRoutesOptions) {
  server.middlewares.use("/__burette/trajectory-pair", async (req, res) => {
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
      const pair = await browserDevTrajectoryPairPayload(filePath, options);
      if (!pair) {
        sendJson(res, 404, { error: "No matching trajectory pair found." });
        return;
      }
      sendJson(res, 200, pair);
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/read-file", async (req, res) => {
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
      const info = await stat(filePath);
      if (!info.isFile() || info.size > options.devFileSizeLimit || !options.devFileExtensions.has(options.fileExtension(filePath))) {
        sendJson(res, 400, { error: "Unsupported file" });
        return;
      }
      const bytes = await readFile(filePath);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Cache-Control", "no-cache");
      res.end(bytes);
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/read-text-file", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const url = new URL(req.url || "", "http://127.0.0.1");
      const path = url.searchParams.get("path");
      const maxBytes = options.textFileReadLimit(url.searchParams.get("maxBytes"));
      const maxImageBytes = imagePreviewReadLimit(url.searchParams.get("maxImageBytes"));
      if (!path) {
        sendJson(res, 400, { error: "Missing path" });
        return;
      }
      const filePath = resolve(path);
      if (!options.isDevFileReadAllowed(filePath)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }
      const info = await stat(filePath);
      if (!info.isFile() || info.size > options.devFileSizeLimit) {
        sendJson(res, 400, { error: "Unsupported file" });
        return;
      }
      const extension = options.fileExtension(filePath);
      const imageMimeType = options.imageMimeTypeForExtension(extension);
      if (imageMimeType && info.size > maxImageBytes) {
        sendJson(res, 200, {
          id: `browser-dev-${filePath}-${info.mtimeMs}`,
          path: filePath,
          title: options.fileTitle(filePath),
          extension,
          language: "image",
          byteCount: info.size,
          content: "",
          truncated: true,
          modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
        }, "no-cache");
        return;
      }
      const bytes = await readFile(filePath);
      if (options.isNumpyArtifactExtension(extension)) {
        sendJson(res, 200, {
          id: `browser-dev-${filePath}-${info.mtimeMs}`,
          path: filePath,
          title: options.fileTitle(filePath),
          extension,
          language: "markdown",
          byteCount: info.size,
          content: options.numpyArtifactTextSummary(filePath, bytes, info.size),
          truncated: false,
          modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
        }, "no-cache");
        return;
      }
      if (imageMimeType) {
        sendJson(res, 200, {
          id: `browser-dev-${filePath}-${info.mtimeMs}`,
          path: filePath,
          title: options.fileTitle(filePath),
          extension,
          language: "image",
          byteCount: info.size,
          content: `data:${imageMimeType};base64,${bytes.toString("base64")}`,
          truncated: false,
          modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
        }, "no-cache");
        return;
      }
      const textBytes = options.readableTextBytes(bytes, extension);
      if (options.looksBinary(textBytes)) {
        if (options.molecularBinaryMetadataExtensions.has(extension)) {
          sendJson(res, 200, {
            id: `browser-dev-${filePath}-${info.mtimeMs}`,
            path: filePath,
            title: options.fileTitle(filePath),
            extension,
            language: "text",
            byteCount: info.size,
            content: options.molecularBinaryArtifactSummary(filePath, info.size),
            truncated: false,
            modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
          }, "no-cache");
          return;
        }
        sendJson(res, 200, {
          id: `browser-dev-${filePath}-${info.mtimeMs}`,
          path: filePath,
          title: options.fileTitle(filePath),
          extension,
          language: "binary metadata",
          byteCount: info.size,
          content: binaryFileSummary(filePath, info.size, extension),
          truncated: false,
          modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
        }, "no-cache");
        return;
      }
      const truncated = textBytes.length > maxBytes;
      const readableBytes = truncated ? textBytes.subarray(0, maxBytes) : textBytes;
      sendJson(res, 200, {
        id: `browser-dev-${filePath}-${info.mtimeMs}`,
        path: filePath,
        title: options.fileTitle(filePath),
        extension,
        language: options.languageForTextExtension(extension),
        byteCount: info.size,
        content: readableBytes.toString("utf8"),
        truncated,
        modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
      }, "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/write-text-file", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "PUT") {
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
      const info = await stat(filePath);
      if (!info.isFile()) {
        sendJson(res, 400, { error: "Unsupported file" });
        return;
      }
      const body = await readJsonBody(req);
      const contents = body.contents;
      const expectedModifiedAt = body.expectedModifiedAt;
      if (typeof contents !== "string") {
        sendJson(res, 400, { error: "Missing file contents" });
        return;
      }
      const byteCount = Buffer.byteLength(contents, "utf8");
      if (byteCount > options.devFileSizeLimit) {
        sendJson(res, 413, { error: "Edited file exceeds the browser-dev size limit" });
        return;
      }
      const currentModifiedAt = Math.max(0, Math.floor(info.mtimeMs));
      if (typeof expectedModifiedAt === "number" && expectedModifiedAt !== currentModifiedAt) {
        sendJson(res, 409, { error: "The file changed on disk. Reopen it before saving your edits." });
        return;
      }
      await writeFile(filePath, contents, "utf8");
      const savedInfo = await stat(filePath);
      sendJson(res, 200, {
        byteCount,
        modifiedAt: Math.max(0, Math.floor(savedInfo.mtimeMs)),
      }, "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });

  server.middlewares.use("/__burette/file-bundle", async (req, res) => {
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
      sendJson(res, 200, options.resolveStructureFileBundle(filePath), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}

function binaryFileSummary(path: string, byteCount: number, extension: string) {
  const format = extension ? `.${extension}` : "unknown";
  return `Binary file\n\nFile: ${path}\nSize: ${byteCount} bytes\nFormat: ${format}\n\nBurette does not have an inline renderer for this binary format yet. The file remains available in the project and can be opened with its default application.\n`;
}

function imagePreviewReadLimit(value: string | null) {
  if (value === null) return IMAGE_PREVIEW_READ_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return IMAGE_PREVIEW_READ_LIMIT;
  return Math.max(0, Math.min(IMAGE_PREVIEW_READ_LIMIT, Math.trunc(parsed)));
}

function positiveScanLimit(value: string | null) {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

const TRAJECTORY_COORDINATE_FORMATS = new Set(["xtc", "trr", "dcd", "nctraj", "nc", "ncdf", "netcdf", "ncrst", "lammpstrj"]);
const TRAJECTORY_MODEL_FORMATS = new Set(["pdb", "ent", "pdbqt", "pqr", "xpdb", "mmcif", "cif", "mcif", "gro"]);
const TRAJECTORY_TOPOLOGY_FORMATS = new Set(["top", "psf", "prmtop", "tpr"]);
const CONVENTIONAL_TRAJECTORY_TOPOLOGY_STEMS = new Set(["topology", "topol", "reference"]);
const TRAJECTORY_PAIR_FORMATS = new Set([
  ...TRAJECTORY_COORDINATE_FORMATS,
  ...TRAJECTORY_MODEL_FORMATS,
  ...TRAJECTORY_TOPOLOGY_FORMATS,
]);

async function browserDevTrajectoryPairPayload(filePath: string, options: BrowserDevFileRoutesOptions) {
  const extension = options.fileExtension(filePath);
  if (!TRAJECTORY_PAIR_FORMATS.has(extension)) return null;
  const files: string[] = [];
  await options.collectDevFiles(dirname(filePath), files);
  const candidates = Array.from(new Set([filePath, ...files]))
    .filter((candidate) => options.isDevFileReadAllowed(candidate))
    .filter((candidate) => TRAJECTORY_PAIR_FORMATS.has(options.fileExtension(candidate)));
  const coordinatePath = TRAJECTORY_COORDINATE_FORMATS.has(extension)
    ? filePath
    : preferredTrajectoryCandidate(candidates, TRAJECTORY_COORDINATE_FORMATS, filePath, options);
  if (!coordinatePath) return null;
  const modelPath = preferredTrajectoryCandidate(
    candidates.filter((candidate) => candidate !== coordinatePath),
    TRAJECTORY_MODEL_FORMATS,
    filePath,
    options,
  ) ?? preferredTrajectoryCandidate(
    candidates.filter((candidate) => candidate !== coordinatePath),
    TRAJECTORY_TOPOLOGY_FORMATS,
    filePath,
    options,
  ) ?? await derivedTopologyForTrajectory(coordinatePath, options);
  if (!modelPath) return null;
  const synthetic = modelPath === derivedTopologyPath(coordinatePath);
  const [coordinateInfo, modelInfo] = await Promise.all([stat(coordinatePath), stat(modelPath)]);
  if (!coordinateInfo.isFile() || !modelInfo.isFile()) return null;
  if (coordinateInfo.size > options.devFileSizeLimit || modelInfo.size > options.devFileSizeLimit) return null;
  const [coordinateBytes, modelBytes] = await Promise.all([readFile(coordinatePath), readFile(modelPath)]);
  const coordinate = trajectorySource(coordinatePath, coordinateBytes, options);
  const model = trajectorySource(modelPath, modelBytes, options);
  return {
    // A derived topology lives in a cache under a hashed name, which says
    // nothing to anyone reading the tab title.
    label: synthetic
      ? `${basename(coordinatePath)} + derived topology`
      : `${basename(coordinatePath)} + ${basename(modelPath)}`,
    byteCount: coordinateInfo.size + modelInfo.size,
    sourcePath: filePath,
    sourceExtension: extension,
    topologyPath: modelPath,
    trajectoryPath: coordinatePath,
    docking: {
      activePose: null,
      sceneMode: null,
      receptor: {
        ...model.source,
        label: synthetic ? "Derived topology" : model.source.label,
        synthetic,
      },
      ligands: [coordinate.source],
    },
    payloads: {
      receptor: { dataBase64: model.dataBase64 },
      ligands: [{ dataBase64: coordinate.dataBase64 }],
    },
  };
}

// Mirrors SYNTHETIC_TOPOLOGY_EXTENSIONS and the header reads on the Rust side, so
// browser dev shows a bare trajectory exactly as the desktop app does.
const DERIVED_TOPOLOGY_FORMATS = new Set(["xtc", "trr", "dcd", "nc", "ncdf", "netcdf", "nctraj"]);
const derivedTopologyRoot = join(tmpdir(), "burette-browser-dev-derived-topology");
const HEADER_READ_BYTES = 64 * 1024;
// Each generated atom line is about 45 bytes. Match the native payload bound
// so a corrupt header cannot allocate a multi-gigabyte placeholder topology.
const MAX_DERIVED_ATOMS = 1_700_000;

function derivedTopologyPath(trajectory: string) {
  return join(derivedTopologyRoot, `${createHash("sha1").update(trajectory).digest("hex").slice(0, 16)}.gro`);
}

async function derivedTopologyForTrajectory(trajectory: string, options: BrowserDevFileRoutesOptions) {
  if (!DERIVED_TOPOLOGY_FORMATS.has(options.fileExtension(trajectory))) return null;
  const output = derivedTopologyPath(trajectory);
  const [info, cached] = await Promise.all([stat(trajectory), stat(output).catch(() => null)]);
  if (cached?.isFile() && cached.mtimeMs > info.mtimeMs) return output;
  const handle = await openFile(trajectory, "r");
  let header: Buffer;
  try {
    header = Buffer.alloc(Math.min(HEADER_READ_BYTES, info.size));
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  const atomCount = headerAtomCount(header);
  if (!atomCount) return null;
  await mkdir(derivedTopologyRoot, { recursive: true });
  await writeFile(output, derivedGro(atomCount), "utf8");
  return output;
}

// Dispatches on the header's own magic rather than the extension, because the
// extension is only a hint and these formats all identify themselves.
function headerAtomCount(header: Buffer) {
  return xtcAtomCount(header) ?? trrAtomCount(header) ?? dcdAtomCount(header) ?? netcdfAtomCount(header);
}

function checkedAtoms(atoms: number | null) {
  return atoms !== null && atoms >= 1 && atoms <= MAX_DERIVED_ATOMS ? atoms : null;
}

function beInt(buffer: Buffer, offset: number) {
  return offset + 4 <= buffer.length ? buffer.readInt32BE(offset) : null;
}

function leInt(buffer: Buffer, offset: number) {
  return offset + 4 <= buffer.length ? buffer.readInt32LE(offset) : null;
}

// XTC is XDR: magic 1995, then the atom count.
function xtcAtomCount(header: Buffer) {
  if (beInt(header, 0) !== 1995) return null;
  return checkedAtoms(beInt(header, 4));
}

// TRR is XDR: magic 1993, a version string whose length shifts everything after
// it, ten section sizes, then the count.
function trrAtomCount(header: Buffer) {
  if (beInt(header, 0) !== 1993) return null;
  const length = beInt(header, 8);
  if (length === null || length < 0 || length > 256) return null;
  return checkedAtoms(beInt(header, 12 + Math.ceil(length / 4) * 4 + 40));
}

// DCD stores the count after two Fortran record blocks, and its endianness varies
// with the machine that wrote it, so the leading marker of 84 decides.
function dcdAtomCount(header: Buffer) {
  const bigEndian = beInt(header, 0) === 84;
  if (!bigEndian && leInt(header, 0) !== 84) return null;
  const read = (offset: number) => (bigEndian ? beInt(header, offset) : leInt(header, offset));
  if (header.subarray(4, 8).toString("latin1") !== "CORD") return null;
  const titleBlock = 4 + 84 + 4;
  const titleBytes = read(titleBlock);
  if (titleBytes === null || titleBytes < 0 || titleBytes >= HEADER_READ_BYTES) return null;
  const countBlock = titleBlock + 4 + titleBytes + 4;
  if (read(countBlock) !== 4) return null;
  return checkedAtoms(read(countBlock + 4));
}

// AMBER NetCDF: walk the classic-format dimension list for the one named "atom".
function netcdfAtomCount(header: Buffer) {
  if (header.subarray(0, 3).toString("latin1") !== "CDF") return null;
  const version = header[3];
  if (version !== 1 && version !== 2) return null;
  let offset = 8;
  if (beInt(header, offset) !== 0x0a) return null;
  const dimensions = beInt(header, offset + 4);
  if (dimensions === null || dimensions < 1 || dimensions > 1024) return null;
  offset += 8;
  for (let index = 0; index < dimensions; index += 1) {
    const nameLength = beInt(header, offset);
    if (nameLength === null || nameLength < 0 || nameLength > 256) return null;
    const padded = Math.ceil(nameLength / 4) * 4;
    const name = header.subarray(offset + 4, offset + 4 + nameLength).toString("latin1");
    const length = beInt(header, offset + 4 + padded);
    if (name === "atom") return checkedAtoms(length);
    offset += 4 + padded + 4;
  }
  return null;
}

// Positions and box are replaced by the trajectory before anything is drawn, so
// only the atom count carries meaning here.
function derivedGro(atomCount: number) {
  const lines = ["Burette derived topology", String(atomCount).padStart(5)];
  const zeros = "0.000".padStart(8).repeat(3);
  for (let index = 0; index < atomCount; index += 1) {
    const serial = String((index + 1) % 100000).padStart(5);
    lines.push(`${serial}${"UNK".padEnd(5)}${"C".padStart(5)}${serial}${zeros}`);
  }
  lines.push("0.00000".padStart(10).repeat(3));
  return `${lines.join("\n")}\n`;
}

function preferredTrajectoryCandidate(
  candidates: string[],
  formats: Set<string>,
  sourcePath: string,
  options: BrowserDevFileRoutesOptions,
) {
  const matches = candidates.filter((candidate) => formats.has(options.fileExtension(candidate)));
  if (!matches.length) return null;
  const sourceStem = trajectoryStem(sourcePath);
  const best = matches
    .map((candidate) => ({ candidate, score: trajectoryCandidateScore(candidate, sourceStem, options) }))
    .sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate))[0]?.candidate ?? null;
  if (!best) return null;
  const bestStem = trajectoryStem(best);
  const relatedStem = bestStem === sourceStem || sourceStem.startsWith(bestStem) || bestStem.startsWith(sourceStem);
  const conventionalTopology = (formats === TRAJECTORY_MODEL_FORMATS || formats === TRAJECTORY_TOPOLOGY_FORMATS)
    && CONVENTIONAL_TRAJECTORY_TOPOLOGY_STEMS.has(bestStem);
  return relatedStem || conventionalTopology ? best : null;
}

function trajectoryCandidateScore(path: string, sourceStem: string, options: BrowserDevFileRoutesOptions) {
  const extension = options.fileExtension(path);
  const stem = trajectoryStem(path);
  let score = stem === sourceStem ? 20 : sourceStem.startsWith(stem) || stem.startsWith(sourceStem) ? 12 : 0;
  if (extension === "gro") score += 8;
  if (extension === "pdb") score += 7;
  if (extension === "tpr") score += 4;
  if (extension === "xtc") score += 8;
  return score;
}

function trajectoryStem(path: string) {
  return basename(path).replace(/\.[^.]+$/u, "").replace(/_(centered|aligned|fit|reimaged|realmd|realmotion).*$/u, "");
}

function trajectorySource(path: string, bytes: Buffer, options: BrowserDevFileRoutesOptions) {
  const extension = options.fileExtension(path);
  return {
    source: {
      path,
      format: trajectoryMolstarFormat(extension),
      binary: trajectorySourceIsBinary(extension),
      label: basename(path),
    },
    dataBase64: bytes.toString("base64"),
  };
}

function trajectoryMolstarFormat(extension: string) {
  if (extension === "cif" || extension === "mcif") return "mmcif";
  if (extension === "ent" || extension === "pqr" || extension === "xpdb") return "pdb";
  if (extension === "nc" || extension === "ncdf" || extension === "netcdf" || extension === "ncrst") return "nctraj";
  return extension;
}

function trajectorySourceIsBinary(extension: string) {
  return TRAJECTORY_COORDINATE_FORMATS.has(extension) || extension === "tpr";
}
