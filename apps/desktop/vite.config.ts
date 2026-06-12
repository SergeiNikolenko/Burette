import { existsSync, statSync, watch } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const desktopDist = fileURLToPath(new URL("dist", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const extraFsAllow = (process.env.BURRETE_DEV_FS_ALLOW ?? "").split(delimiter).filter(Boolean);
const defaultDevFileRoots = (process.env.BURRETE_DEV_DEFAULT_FILES ?? "").split(delimiter).filter(Boolean);
const defaultDesktopRoots = [
  join(homedir(), "Desktop", "BurettePreviewSamples"),
  join(homedir(), "Desktop", "xyzrender-main"),
].filter((path) => existsSync(path));
const defaultProjectFiles = [
  join(repoRoot, "samples", "large", "litr_moses_10k.csv"),
].filter((path) => existsSync(path));
const defaultDevFileSources = defaultDevFileRoots.length > 0
  ? defaultDevFileRoots
  : [...defaultProjectFiles, ...defaultDesktopRoots];
const defaultFsAllow = defaultDevFileSources.map((path) => {
  try {
    return statSync(path).isDirectory() ? path : dirname(path);
  } catch (_) {
    return dirname(path);
  }
});
const devFsAllowRoots = [repoRoot, ...defaultFsAllow, ...extraFsAllow].map((path) => resolve(path));
const execFileAsync = promisify(execFile);
const BROWSER_DEV_APP_ICONS: Record<string, string> = {
  finder: "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/FinderIcon.icns",
  maestro: "/Applications/SchrodingerSuites2026-1/Maestro.app/Contents/Resources/Maestro.icns",
  chimerax: "/Applications/ChimeraX-1.10.app/Contents/Resources/chimerax-icon.icns",
  pymol: "/Applications/PyMOL.app/Contents/Resources/pymol.icns",
  avogadro2: "/Applications/Avogadro2.app/Contents/Resources/avogadro.icns",
  datawarrior: "/Applications/DataWarrior.app/Contents/Resources/datawarrior.icns",
  vesta: "/Applications/VESTA.app/Contents/Resources/VESTA.icns",
};
const DEV_FILE_SIZE_LIMIT = 75 * 1024 * 1024;
const TEXT_FILE_READ_LIMIT = 12 * 1024 * 1024;
const DESMOND_PREVIEW_TARGET_MB = 24;
const RDKIT_WASM_PATH = join(repoRoot, "PreviewExtension", "Web", "rdkit", "RDKit_minimal.wasm");
type StructureAttachmentRole = "topology" | "trajectory" | "trajectoryPointer" | "configuration";
type StructureFileBundle = {
  kind: "desmond" | "md" | "single";
  primaryPath: string;
  inputPath: string;
  attachments: Array<{ role: StructureAttachmentRole; path: string }>;
};
const DEV_FILE_EXTENSIONS = new Set([
  "abi", "bcif", "cif", "cms", "com", "csv", "cub", "cube", "dcd", "ent", "fdf", "gro",
  "in", "inp", "lammpstrj", "log", "mae", "mae.gz", "maegz", "mcif", "mmcif", "mol",
  "mol2", "mvsj", "mvsx", "nctraj", "nw", "out", "pdb", "pdbqt", "pqr", "prmtop", "psf", "psi4", "qcin",
  "sd", "sdf", "smi", "smiles", "top", "trr", "tsv", "vasp", "xtc", "xyz",
  "dtr",
]);
const SCHRODINGER_RUN = "/opt/schrodinger/suites2026-1/run";
const DESMOND_PREVIEW_EXTRACTOR = join(repoRoot, "scripts", "desmond_preview_extract.py");
const XYZRENDER_PRESET_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "flat", label: "Flat" },
  { value: "paton", label: "Paton" },
  { value: "pmol", label: "PMol" },
  { value: "skeletal", label: "Skeletal" },
  { value: "bubble", label: "Bubble" },
  { value: "tube", label: "Tube" },
  { value: "btube", label: "BTube" },
  { value: "mtube", label: "MTube" },
  { value: "wire", label: "Wire" },
  { value: "graph", label: "Graph" },
  { value: "custom", label: "Custom JSON" },
];

function readOptionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function readOptionalNonNegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function readOptionalFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readOptionalInteger(value: unknown) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? number : null;
}

function readOptionalBoolean(value: unknown) {
  if (value === true || value === false) return value;
  return null;
}

function readOptionalText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

function readFieldMode(value: unknown) {
  const text = readOptionalText(value);
  return text && ["auto", "off", "density", "mo", "esp", "nci"].includes(text) ? text : null;
}

function readFieldSurfaceStyle(value: unknown) {
  const text = readOptionalText(value);
  return text && ["solid", "mesh", "contour", "dot"].includes(text) ? text : null;
}

function normalizeSupercell(value: unknown) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const parsed = value.map((item) => readOptionalInteger(item));
  if (parsed.some((item) => !item || item < 1)) return null;
  return parsed as [number, number, number];
}

function normalizeXyzrenderControls(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    transparentBackground: readOptionalBoolean(source.transparentBackground),
    canvasSize: readOptionalNumber(source.canvasSize),
    atomScale: readOptionalNumber(source.atomScale),
    bondWidth: readOptionalNumber(source.bondWidth),
    atomStrokeWidth: readOptionalNumber(source.atomStrokeWidth),
    molColor: readOptionalText(source.molColor),
    gradients: readOptionalBoolean(source.gradients),
    fog: readOptionalBoolean(source.fog),
    fogStrength: readOptionalNumber(source.fogStrength),
    showVdw: readOptionalBoolean(source.showVdw),
    vdwOpacity: readOptionalNumber(source.vdwOpacity),
    vdwScale: readOptionalNumber(source.vdwScale),
    hideBonds: readOptionalBoolean(source.hideBonds),
    showCell: readOptionalBoolean(source.showCell),
    showGhosts: readOptionalBoolean(source.showGhosts),
    showAxes: readOptionalBoolean(source.showAxes),
    cellWidth: readOptionalNumber(source.cellWidth),
    supercell: normalizeSupercell(source.supercell),
    fieldMode: readFieldMode(source.fieldMode),
    fieldIso: readOptionalNumber(source.fieldIso),
    fieldOpacity: readOptionalNonNegativeNumber(source.fieldOpacity),
    fieldSurfaceStyle: readFieldSurfaceStyle(source.fieldSurfaceStyle),
    fieldMoPositiveColor: readOptionalText(source.fieldMoPositiveColor),
    fieldMoNegativeColor: readOptionalText(source.fieldMoNegativeColor),
    fieldDensityColor: readOptionalText(source.fieldDensityColor),
    fieldCmapPalette: readOptionalText(source.fieldCmapPalette),
    fieldCmapMin: readOptionalFiniteNumber(source.fieldCmapMin),
    fieldCmapMax: readOptionalFiniteNumber(source.fieldCmapMax),
    customConfigPath: readOptionalText(source.customConfigPath),
    extraArguments: readOptionalText(source.extraArguments),
  };
}

function splitCommandLine(value: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current) tokens.push(current);
  return tokens;
}

function sanitizedExtraArguments(value: string | null, stripFieldArguments = false) {
  if (!value) return [];
  const blockedValueFlags = new Set(["-o", "--output", "-go", "--gif-output", "--config", "--ref"]);
  const blocked = new Set(blockedValueFlags);
  const blockedValueCounts = new Map<string, number>();
  if (stripFieldArguments) {
    ["--esp", "--nci-surf", "--iso", "--opacity", "--surface-style", "--dens-color", "--cmap-palette"].forEach((flag) => {
      blocked.add(flag);
      blockedValueFlags.add(flag);
    });
    [["--mo-colors", 2], ["--cmap-range", 2]].forEach(([flag, count]) => {
      blocked.add(String(flag));
      blockedValueCounts.set(String(flag), Number(count));
    });
    ["--mo", "--dens"].forEach((flag) => blocked.add(flag));
  }
  const blockedPrefixes = [...blocked].map((flag) => `${flag}=`);
  const result: string[] = [];
  let skipNext = 0;
  for (const token of splitCommandLine(value)) {
    if (skipNext > 0) {
      skipNext -= 1;
      continue;
    }
    if (blocked.has(token)) {
      skipNext = blockedValueCounts.get(token) ?? (blockedValueFlags.has(token) ? 1 : 0);
      continue;
    }
    if (blockedPrefixes.some((flag) => token.startsWith(flag))) continue;
    result.push(token);
  }
  return result;
}

function resolveConfigArgument(preset: string, controls: ReturnType<typeof normalizeXyzrenderControls>) {
  if (preset !== "custom") return preset;
  return controls.customConfigPath || "default";
}

function resolveEffectivePreset(preset: string, controls: ReturnType<typeof normalizeXyzrenderControls>) {
  return preset === "custom" && resolveConfigArgument(preset, controls) === "default" ? "default" : preset;
}

function buildXyzrenderArgs(
  inputPath: string,
  outputPath: string,
  preset: string,
  orientationRefPath: string | null,
  controls: ReturnType<typeof normalizeXyzrenderControls>,
) {
  const args = [inputPath, "-o", outputPath, "--config", resolveConfigArgument(preset, controls)];
  if (orientationRefPath) args.push("--ref", orientationRefPath);
  if (controls.transparentBackground === true) args.push("--transparent");
  if (controls.canvasSize) args.push("-S", String(controls.canvasSize));
  if (controls.atomScale) args.push("-a", String(controls.atomScale));
  if (controls.bondWidth) args.push("-b", String(controls.bondWidth));
  if (controls.atomStrokeWidth) args.push("-s", String(controls.atomStrokeWidth));
  if (controls.molColor) args.push("--mol-color", controls.molColor);
  if (controls.gradients === true) args.push("--grad");
  if (controls.gradients === false) args.push("--no-grad");
  if (controls.fog === true) args.push("--fog");
  if (controls.fog === false) args.push("--no-fog");
  if (controls.fogStrength) args.push("-F", String(controls.fogStrength));
  if (controls.showVdw === true) args.push("--vdw");
  if (controls.vdwOpacity) args.push("--vdw-opacity", String(controls.vdwOpacity));
  if (controls.vdwScale) args.push("--vdw-scale", String(controls.vdwScale));
  if (controls.hideBonds === true) args.push("--no-bonds");
  if (controls.showCell === true) args.push("--cell");
  if (controls.showCell === false) args.push("--no-cell");
  if (controls.showGhosts === true) args.push("--ghosts");
  if (controls.showGhosts === false) args.push("--no-ghosts");
  if (controls.showAxes === true) args.push("--axes");
  if (controls.showAxes === false) args.push("--no-axes");
  if (controls.cellWidth) args.push("--cell-width", String(controls.cellWidth));
  if (controls.supercell) args.push("--supercell", ...controls.supercell.map(String));
  args.push(...sanitizedExtraArguments(controls.extraArguments, Boolean(controls.fieldMode)));
  if (controls.fieldMode && controls.fieldMode !== "auto") {
    if (controls.fieldMode === "density") args.push("--dens");
    else if (controls.fieldMode === "mo") args.push("--mo");
    else if (controls.fieldMode === "esp") args.push("--esp", inputPath);
    else if (controls.fieldMode === "nci") args.push("--nci-surf", inputPath);
  }
  if (controls.fieldIso != null && controls.fieldIso > 0) args.push("--iso", String(controls.fieldIso));
  if (controls.fieldOpacity != null) args.push("--opacity", String(controls.fieldOpacity));
  if (controls.fieldSurfaceStyle) args.push("--surface-style", controls.fieldSurfaceStyle);
  if (controls.fieldMoPositiveColor && controls.fieldMoNegativeColor) args.push("--mo-colors", controls.fieldMoPositiveColor, controls.fieldMoNegativeColor);
  if (controls.fieldDensityColor) args.push("--dens-color", controls.fieldDensityColor);
  if (controls.fieldCmapPalette) args.push("--cmap-palette", controls.fieldCmapPalette);
  if (controls.fieldCmapMin != null && controls.fieldCmapMax != null) args.push("--cmap-range", String(controls.fieldCmapMin), String(controls.fieldCmapMax));
  return args;
}

function normalizeXyzrenderPreset(value: string | null) {
  const normalized = String(value || "default").trim().toLowerCase();
  return XYZRENDER_PRESET_OPTIONS.some((option) => option.value === normalized) ? normalized : "default";
}

function normalizeXyzrenderInputExtension(value: string | null) {
  const normalized = String(value || "xyz").trim().toLowerCase().replace(/^\./, "");
  return ["xyz", "sdf", "sd", "smi", "smiles", "pdb", "cif"].includes(normalized) ? normalized : "xyz";
}

function resolveXyzrenderExecutable() {
  const candidates = [
    process.env.HOME ? join(process.env.HOME, ".local/bin/xyzrender") : "",
    "/opt/homebrew/bin/xyzrender",
    "/usr/local/bin/xyzrender",
  ].filter(Boolean);
  const pathRows = String(process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const row of pathRows) candidates.push(join(row, "xyzrender"));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function browserDevXyzrenderPlugin() {
  return {
    name: "burrete-browser-dev-xyzrender",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/__burette/dev-files", async (_req, res) => {
        try {
          const files = await collectDefaultDevFiles();
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ files }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.middlewares.use("/__burette/rdkit-wasm", async (_req, res) => {
        try {
          const bytes = await readFile(RDKIT_WASM_PATH);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/wasm");
          res.setHeader("Content-Length", String(bytes.length));
          res.setHeader("Cache-Control", "no-cache");
          res.end(bytes);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.middlewares.use("/__burette/agent-session/", async (req, res) => {
        const sessionDir = process.env.BURRETE_AGENT_SHELL_SESSION_DIR
          ? resolve(process.env.BURRETE_AGENT_SHELL_SESSION_DIR)
          : null;
        const method = (req.method || "GET").toUpperCase();
        const url = new URL(req.url || "", "http://127.0.0.1");
        const fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
        if (!sessionDir || !["actions.json", "observe.json", "session.json", "events"].includes(fileName)) {
          res.statusCode = sessionDir ? 404 : 403;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: sessionDir ? "Not found" : "Agent shell session is not enabled" }));
          return;
        }
        if (fileName === "events") {
          if (method !== "GET") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          const sendActionsEvent = () => {
            res.write(`event: actions\ndata: ${JSON.stringify({ file: "actions.json", at: new Date().toISOString() })}\n\n`);
          };
          sendActionsEvent();
          const watcher = watch(sessionDir, (_eventType, changedFileName) => {
            if (changedFileName === "actions.json") sendActionsEvent();
          });
          req.on("close", () => watcher.close());
          return;
        }
        const filePath = resolve(sessionDir, fileName);
        if (!filePath.startsWith(`${sessionDir}/`)) {
          res.statusCode = 403;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Forbidden" }));
          return;
        }
        try {
          if (method === "GET") {
            const fallback = fileName === "actions.json"
              ? { apiVersion: "burette-agent-control/v1", actions: [] }
              : {};
            let value = fallback;
            if (existsSync(filePath)) value = JSON.parse(await readFile(filePath, "utf8"));
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache");
            res.end(JSON.stringify(value));
            return;
          }
          if (method === "PUT") {
            if (fileName === "session.json") {
              res.statusCode = 405;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "session.json is read-only" }));
              return;
            }
            const body = await readJsonBody(req);
            await mkdir(sessionDir, { recursive: true });
            await writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Method not allowed" }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.middlewares.use("/__burette/app-icon/", async (req, res) => {
        const method = (req.method || "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        try {
          const url = new URL(req.url || "", "http://127.0.0.1");
          const id = decodeURIComponent(url.pathname.replace(/^\/+/, "")).replace(/\.png$/u, "");
          const iconPath = BROWSER_DEV_APP_ICONS[id];
          if (!iconPath || !existsSync(iconPath)) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Icon not found" }));
            return;
          }
          const cacheDir = join(tmpdir(), "burrete-app-icons");
          const outputPath = join(cacheDir, `${id}.png`);
          if (!existsSync(outputPath)) {
            await mkdir(cacheDir, { recursive: true });
            await execFileAsync("/usr/bin/sips", ["-s", "format", "png", iconPath, "--out", outputPath]);
          }
          const bytes = await readFile(outputPath);
          res.statusCode = 200;
          res.setHeader("Content-Type", "image/png");
          res.setHeader("Content-Length", String(bytes.length));
          res.setHeader("Cache-Control", "no-cache");
          res.end(method === "HEAD" ? undefined : bytes);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.middlewares.use("/__burette/read-file", async (req, res) => {
        if ((req.method || "GET").toUpperCase() !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        try {
          const url = new URL(req.url || "", "http://127.0.0.1");
          const path = url.searchParams.get("path");
          if (!path) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Missing path" }));
            return;
          }
          const filePath = resolve(path);
          if (!isDevFileReadAllowed(filePath)) {
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Forbidden" }));
            return;
          }
          const info = await stat(filePath);
          if (!info.isFile() || info.size > DEV_FILE_SIZE_LIMIT || !DEV_FILE_EXTENSIONS.has(fileExtension(filePath))) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Unsupported file" }));
            return;
          }
          const bytes = await readFile(filePath);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Content-Length", String(bytes.length));
          res.setHeader("Cache-Control", "no-cache");
          res.end(bytes);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.middlewares.use("/__burette/read-text-file", async (req, res) => {
        if ((req.method || "GET").toUpperCase() !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        try {
          const url = new URL(req.url || "", "http://127.0.0.1");
          const path = url.searchParams.get("path");
          const maxBytes = textFileReadLimit(url.searchParams.get("maxBytes"));
          if (!path) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Missing path" }));
            return;
          }
          const filePath = resolve(path);
          if (!isDevFileReadAllowed(filePath)) {
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Forbidden" }));
            return;
          }
          const info = await stat(filePath);
          if (!info.isFile() || info.size > DEV_FILE_SIZE_LIMIT) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Unsupported file" }));
            return;
          }
          const bytes = await readFile(filePath);
          const extension = fileExtension(filePath);
          const textBytes = readableTextBytes(bytes, extension);
          if (looksBinary(textBytes)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: `${filePath} is not a text file` }));
            return;
          }
          const truncated = textBytes.length > maxBytes;
          const readableBytes = truncated ? textBytes.subarray(0, maxBytes) : textBytes;
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.end(JSON.stringify({
            id: `browser-dev-${filePath}-${info.mtimeMs}`,
            path: filePath,
            title: fileTitle(filePath),
            extension,
            language: languageForTextExtension(extension),
            byteCount: info.size,
            content: readableBytes.toString("utf8"),
            truncated,
            modifiedAt: Math.max(0, Math.floor(info.mtimeMs)),
          }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.middlewares.use("/__burette/file-bundle", async (req, res) => {
        if ((req.method || "GET").toUpperCase() !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        try {
          const url = new URL(req.url || "", "http://127.0.0.1");
          const path = url.searchParams.get("path");
          if (!path) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Missing path" }));
            return;
          }
          const filePath = resolve(path);
          if (!isDevFileReadAllowed(filePath)) {
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Forbidden" }));
            return;
          }
          const bundle = resolveStructureFileBundle(filePath);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.end(JSON.stringify(bundle));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.middlewares.use("/__burette/desmond-preview", async (req, res) => {
        if ((req.method || "GET").toUpperCase() !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        try {
          const url = new URL(req.url || "", "http://127.0.0.1");
          const path = url.searchParams.get("path");
          if (!path) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Missing path" }));
            return;
          }
          const filePath = resolve(path);
          if (!isDevFileReadAllowed(filePath)) {
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Forbidden" }));
            return;
          }
          const bundle = resolveStructureFileBundle(filePath);
          if (bundle.kind !== "desmond") {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "No Desmond trajectory candidate found." }));
            return;
          }
          if (!existsSync(SCHRODINGER_RUN) || !existsSync(DESMOND_PREVIEW_EXTRACTOR)) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Schrodinger Desmond preview extractor is unavailable." }));
            return;
          }
          const tempDirectory = await mkdtemp(join(tmpdir(), "burrete-desmond-preview-"));
          const outputPath = join(tempDirectory, "desmond-preview.pdb");
          try {
            await execFileAsync(
              SCHRODINGER_RUN,
              [
                "python3",
                DESMOND_PREVIEW_EXTRACTOR,
                bundle.inputPath,
                "--frames",
                "0",
                "--atoms",
                "0",
                "--target-mb",
                String(DESMOND_PREVIEW_TARGET_MB),
                "--output",
                outputPath,
              ],
              { timeout: 0, maxBuffer: 16 * 1024 * 1024 },
            );
            const bytes = await readFile(outputPath);
            if (!bytes.length) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ error: "Desmond preview extractor produced an empty PDB file." }));
              return;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader("Content-Length", String(bytes.length));
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("X-Burrete-Preview-Extension", "pdb");
            res.end(bytes);
          } finally {
            await rm(tempDirectory, { recursive: true, force: true });
          }
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.middlewares.use("/__burette/xyzrender", async (req, res) => {
        const reply = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(body));
        };
        if ((req.method || "GET").toUpperCase() !== "POST") {
          reply(405, { error: "Method not allowed" });
          return;
        }
        try {
          const body = await readJsonBody(req);
          const inputPath = typeof body.path === "string" ? body.path : null;
          if (!inputPath) {
            reply(400, { error: "Missing path" });
            return;
          }
          const preset = normalizeXyzrenderPreset(typeof body.preset === "string" ? body.preset : null);
          const orientationRef = normalizeOrientationRef(typeof body.orientationRef === "string" ? body.orientationRef : null);
          const controls = normalizeXyzrenderControls(body.controls);
          const inputData = typeof body.inputDataBase64 === "string"
            ? Buffer.from(body.inputDataBase64, "base64")
            : null;
          const inputExtension = normalizeXyzrenderInputExtension(typeof body.inputExtension === "string" ? body.inputExtension : null);
          const executable = resolveXyzrenderExecutable();
          if (!executable) {
            reply(404, { error: "External xyzrender executable was not found." });
            return;
          }
          const tempDirectory = await mkdtemp(join(tmpdir(), "burrete-xyzrender-"));
          const outputPath = join(tempDirectory, "xyzrender.svg");
          const convertedInputPath = join(tempDirectory, `xyzrender-input.${inputExtension}`);
          const orientationRefPath = join(tempDirectory, "orientation-ref.xyz");
          const startedAt = Date.now();
          try {
            const effectiveInputPath = inputData?.length ? convertedInputPath : inputPath;
            if (inputData?.length) {
              await writeFile(convertedInputPath, inputData);
            }
            const args = buildXyzrenderArgs(
              effectiveInputPath,
              outputPath,
              preset,
              orientationRef ? orientationRefPath : null,
              controls,
            );
            if (orientationRef) {
              await writeFile(orientationRefPath, orientationRef, "utf8");
            }
            const { stdout, stderr } = await execFileAsync(
              executable,
              args,
              { timeout: 25_000, maxBuffer: 8 * 1024 * 1024 },
            );
            const svg = await readFile(outputPath, "utf8");
            if (!svg.trim()) {
              reply(500, { error: "External xyzrender produced an empty SVG output file." });
              return;
            }
            reply(200, {
              svg,
              preset: resolveEffectivePreset(preset, controls),
              configArgument: resolveConfigArgument(preset, controls),
              elapsedMs: Date.now() - startedAt,
              log: `${stdout || ""}${stderr || ""}`,
              xyzrenderControls: controls,
              xyzrenderPresetOptions: XYZRENDER_PRESET_OPTIONS,
            });
          } finally {
            await rm(tempDirectory, { recursive: true, force: true });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          reply(500, { error: message });
        }
      });
    },
  };
}

async function collectDefaultDevFiles() {
  const files: string[] = [];
  for (const source of defaultDevFileSources) {
    await collectDevFiles(source, files);
  }
  return Array.from(new Set(files)).sort((left, right) => {
    const leftLarge = left.includes("/samples/large/");
    const rightLarge = right.includes("/samples/large/");
    if (leftLarge !== rightLarge) return leftLarge ? -1 : 1;
    return left.localeCompare(right);
  });
}

async function collectDevFiles(path: string, files: string[]) {
  let info;
  try {
    info = await stat(path);
  } catch (_) {
    return;
  }
  if (info.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      await collectDevFiles(join(path, entry.name), files);
    }
    return;
  }
  if (!info.isFile() || info.size > DEV_FILE_SIZE_LIMIT) return;
  if (!DEV_FILE_EXTENSIONS.has(fileExtension(path))) return;
  if (path.endsWith("/no-molecule-column.csv")) return;
  files.push(path);
}

function isDevFileReadAllowed(path: string) {
  return devFsAllowRoots.some((root) => {
    const relation = relative(root, path);
    return relation === "" || (relation && !relation.startsWith("..") && !relation.startsWith("/"));
  });
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

function looksBinary(bytes: Buffer) {
  const limit = Math.min(bytes.length, TEXT_FILE_READ_LIMIT);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

function textFileReadLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return TEXT_FILE_READ_LIMIT;
  return Math.min(parsed, TEXT_FILE_READ_LIMIT);
}

function readableTextBytes(bytes: Buffer, extension: string) {
  if (extension === "maegz") return gunzipSync(bytes);
  return bytes;
}

function languageForTextExtension(extension: string) {
  if (extension === "md" || extension === "markdown" || extension === "mdx") return "markdown";
  if (extension === "sh" || extension === "bash" || extension === "zsh") return "shell";
  if (extension === "js" || extension === "jsx" || extension === "mjs" || extension === "cjs") return "javascript";
  if (extension === "ts" || extension === "tsx") return "typescript";
  if (extension === "json") return "json";
  if (extension === "yaml" || extension === "yml") return "yaml";
  if (extension === "toml") return "toml";
  if (extension === "py") return "python";
  if (extension === "rs") return "rust";
  if (extension === "css") return "css";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "xml") return "xml";
  if (extension === "mae" || extension === "maegz" || extension === "cms") return "maestro";
  return "text";
}

function candidateDesmondBaseNames(stem: string) {
  const bases = [stem];
  for (const suffix of ["-out", "_out", "-in", "_in"]) {
    if (stem.endsWith(suffix)) bases.push(stem.slice(0, -suffix.length));
  }
  for (const base of [...bases]) {
    bases.push(base.replace(/_replica_(\d+)$/u, "_replica$1"));
    bases.push(base.replace(/replica_(\d+)$/u, "replica$1"));
  }
  return Array.from(new Set(bases.filter(Boolean)));
}

function candidateDesmondBases(path: string) {
  const name = path.replace(/\\/g, "/").split("/").pop() || "";
  const extension = fileExtension(name);
  const stem = extension ? name.slice(0, Math.max(0, name.length - extension.length - 1)) : name;
  return candidateDesmondBaseNames(stem);
}

function existingFileCandidate(candidates: string[]) {
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) || null;
}

function existingDirectoryCandidate(candidates: string[]) {
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory()) || null;
}

function resolveStructureFileBundle(path: string): StructureFileBundle {
  return resolveDesmondFileBundle(path) ?? resolveMdFileBundle(path) ?? {
    kind: "single",
    primaryPath: path,
    inputPath: path,
    attachments: [],
  };
}

function resolveDesmondFileBundle(path: string): StructureFileBundle | null {
  const extension = fileExtension(path);
  if (extension === "dtr") {
    const trjDirectory = dirname(path);
    const base = trjDirectory.replace(/\\/g, "/").split("/").pop()?.replace(/_trj$/u, "") || "";
    const cmsPath = existingFileCandidate(candidateDesmondBaseNames(base).flatMap((candidate) => [
      join(dirname(trjDirectory), `${candidate}-out.cms`),
      join(dirname(trjDirectory), `${candidate}.cms`),
    ]));
    if (!cmsPath || !existsSync(trjDirectory) || !statSync(trjDirectory).isDirectory()) return null;
    return {
      kind: "desmond",
      primaryPath: cmsPath,
      inputPath: path,
      attachments: [
        { role: "topology", path: cmsPath },
        { role: "trajectory", path: trjDirectory },
        { role: "trajectoryPointer", path },
      ],
    };
  }
  if (extension !== "cms") return null;
  for (const base of candidateDesmondBases(path)) {
    const trjDirectory = existingDirectoryCandidate([join(dirname(path), `${base}_trj`)]);
    if (!trjDirectory) continue;
    const clickme = join(trjDirectory, "clickme.dtr");
    const attachments: StructureFileBundle["attachments"] = [
      { role: "topology", path },
      { role: "trajectory", path: trjDirectory },
    ];
    if (existsSync(clickme) && statSync(clickme).isFile()) {
      attachments.push({ role: "trajectoryPointer", path: clickme });
    }
    return {
      kind: "desmond",
      primaryPath: path,
      inputPath: path,
      attachments,
    };
  }
  return null;
}

function resolveMdFileBundle(path: string): StructureFileBundle | null {
  const extension = fileExtension(path);
  const base = path.slice(0, Math.max(0, path.length - extension.length - 1));
  if (["xtc", "trr", "dcd", "nctraj"].includes(extension)) {
    const topology = existingFileCandidate(
      ["pdb", "gro", "cif", "mmcif", "bcif", "psf", "prmtop", "top"].map((candidate) => `${base}.${candidate}`),
    );
    if (!topology) return null;
    return {
      kind: "md",
      primaryPath: topology,
      inputPath: path,
      attachments: [
        { role: "topology", path: topology },
        { role: "trajectory", path },
      ],
    };
  }
  if (["pdb", "gro", "cif", "mmcif", "bcif", "psf", "prmtop", "top"].includes(extension)) {
    const trajectory = existingFileCandidate(
      ["xtc", "trr", "dcd", "nctraj"].map((candidate) => `${base}.${candidate}`),
    );
    if (!trajectory) return null;
    return {
      kind: "md",
      primaryPath: path,
      inputPath: path,
      attachments: [
        { role: "topology", path },
        { role: "trajectory", path: trajectory },
      ],
    };
  }
  return null;
}

function isDesmondPreviewCandidate(path: string) {
  return resolveDesmondFileBundle(path) !== null;
}

async function readJsonBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function normalizeOrientationRef(value: string | null) {
  if (!value) return null;
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (Buffer.byteLength(normalized, "utf8") > 4 * 1024 * 1024) return null;
  const lines = normalized.split("\n");
  const atomCount = Number.parseInt((lines[0] || "").trim().split(/\s+/u)[0] || "", 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0 || lines.length < atomCount + 2) return null;
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function ketcherRaphaelImportShimPlugin(): Plugin {
  const target = "raphaelModule = require('raphael');";
  const replacement = "raphaelModule = __burreteRaphael;";

  return {
    name: "burrete-ketcher-raphael-import-shim",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/");
      if (!normalized.endsWith("/node_modules/ketcher-core/dist/index.modern.js")) return null;
      if (!code.includes(target)) return null;
      return {
        code: `import __burreteRaphael from "raphael";\n${code.replaceAll(target, replacement)}`,
        map: null,
      };
    },
  };
}

function deferKetcherCssPlugin(): Plugin {
  return {
    name: "burrete-defer-ketcher-css",
    transformIndexHtml(html) {
      return html.replace(/\n\s*<link rel="stylesheet" crossorigin href="\.\/assets\/ketcher-[^"]+\.css">/gu, "");
    },
  };
}

function desktopManualChunks(id: string) {
  const normalized = id.replaceAll("\\", "/");
  if (normalized.includes("/node_modules/molstar/")) return "molstar";
  if (
    normalized.includes("/node_modules/raphael/")
    || normalized.includes("/node_modules/eve-raphael/")
    || normalized.includes("/node_modules/ketcher-core/")
    || normalized.includes("/node_modules/ketcher-react/")
    || normalized.includes("/node_modules/ketcher-standalone/")
    || normalized.includes("/node_modules/indigo-ketcher/")
  ) {
    return "ketcher";
  }
  return undefined;
}

function resolveModulePreloadDependencies(_url: string, deps: string[], context: { hostType: "html" | "js" }) {
  if (context.hostType !== "html") return deps;
  return deps.filter((dep) => !dep.includes("ketcher"));
}

export default defineConfig({
  root: desktopRoot,
  base: "./",
  plugins: [react(), ketcherRaphaelImportShimPlugin(), deferKetcherCssPlugin(), browserDevXyzrenderPlugin()],
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  define: {
    global: "globalThis",
    "import.meta.env.BURRETE_REPO_ROOT": JSON.stringify(repoRoot),
    process: JSON.stringify({ env: {} }),
    "process.env": "{}",
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
        process: JSON.stringify({ env: {} }),
        "process.env": "{}",
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: devFsAllowRoots },
    watch: { ignored: ["src-tauri/target/**"] },
  },
  build: {
    outDir: desktopDist,
    emptyOutDir: true,
    modulePreload: {
      resolveDependencies: resolveModulePreloadDependencies,
    },
    rollupOptions: {
      output: {
        manualChunks: desktopManualChunks,
        onlyExplicitManualChunks: true,
      },
    },
  },
  clearScreen: false,
});
