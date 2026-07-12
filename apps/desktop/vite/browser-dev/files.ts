import { readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { ViteDevServer } from "vite";

import { sendJson, sendJsonError } from "./http";

type BrowserDevFileRoutesOptions = {
  collectDefaultDevFiles: () => Promise<string[]>;
  collectDevFiles: (path: string, files: string[]) => Promise<void>;
  devFileExtensions: Set<string>;
  devFileSizeLimit: number;
  fileExtension: (path: string) => string;
  fileTitle: (path: string) => string;
  isDevFileReadAllowed: (path: string) => boolean | string;
  isNumpyArtifactExtension: (extension: string) => boolean;
  languageForTextExtension: (extension: string) => string;
  looksBinary: (bytes: Buffer) => boolean;
  molecularBinaryArtifactSummary: (path: string, byteCount: number) => string;
  molecularBinaryMetadataExtensions: Set<string>;
  numpyArtifactTextSummary: (path: string, bytes: Buffer, byteCount: number) => string;
  readableTextBytes: (bytes: Buffer, extension: string) => Buffer;
  resolveStructureFileBundle: (path: string) => unknown;
  textFileReadLimit: (value: string | null) => number;
};

export function registerBrowserDevFileDiscoveryRoute(server: ViteDevServer, options: BrowserDevFileRoutesOptions) {
  server.middlewares.use("/__burette/dev-files", async (req, res) => {
    try {
      const url = new URL(req.url || "", "http://127.0.0.1");
      const root = url.searchParams.get("root");
      let files: string[];
      if (root) {
        const rootPath = resolve(root);
        if (!options.isDevFileReadAllowed(rootPath)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        files = [];
        await options.collectDevFiles(rootPath, files);
        files = Array.from(new Set(files)).sort((left, right) => left.localeCompare(right));
      } else {
        files = await options.collectDefaultDevFiles();
      }
      sendJson(res, 200, { files });
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
      const bytes = await readFile(filePath);
      const extension = options.fileExtension(filePath);
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
        sendJson(res, 400, { error: `${filePath} is not a text file` });
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

const TRAJECTORY_COORDINATE_FORMATS = new Set(["xtc", "trr", "dcd", "nctraj", "nc", "ncdf", "netcdf", "ncrst", "lammpstrj"]);
const TRAJECTORY_MODEL_FORMATS = new Set(["pdb", "ent", "pdbqt", "pqr", "xpdb", "mmcif", "cif", "mcif", "gro"]);
const TRAJECTORY_TOPOLOGY_FORMATS = new Set(["top", "psf", "prmtop", "tpr"]);
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
  );
  if (!modelPath) return null;
  const [coordinateInfo, modelInfo] = await Promise.all([stat(coordinatePath), stat(modelPath)]);
  if (!coordinateInfo.isFile() || !modelInfo.isFile()) return null;
  if (coordinateInfo.size > options.devFileSizeLimit || modelInfo.size > options.devFileSizeLimit) return null;
  const [coordinateBytes, modelBytes] = await Promise.all([readFile(coordinatePath), readFile(modelPath)]);
  const coordinate = trajectorySource(coordinatePath, coordinateBytes, options);
  const model = trajectorySource(modelPath, modelBytes, options);
  return {
    label: `${basename(coordinatePath)} + ${basename(modelPath)}`,
    byteCount: coordinateInfo.size + modelInfo.size,
    sourcePath: filePath,
    sourceExtension: extension,
    topologyPath: modelPath,
    trajectoryPath: coordinatePath,
    docking: {
      activePose: null,
      sceneMode: null,
      receptor: model.source,
      ligands: [coordinate.source],
    },
    payloads: {
      receptor: { dataBase64: model.dataBase64 },
      ligands: [{ dataBase64: coordinate.dataBase64 }],
    },
  };
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
  return matches
    .map((candidate) => ({ candidate, score: trajectoryCandidateScore(candidate, sourceStem, options) }))
    .sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate))[0]?.candidate ?? null;
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
