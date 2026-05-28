import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineConfig } from "vite";
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
const DEV_FILE_SIZE_LIMIT = 75 * 1024 * 1024;
const RDKIT_WASM_PATH = join(repoRoot, "PreviewExtension", "Web", "rdkit", "RDKit_minimal.wasm");
const DEV_FILE_EXTENSIONS = new Set([
  "abi", "bcif", "cif", "cms", "com", "csv", "cub", "cube", "dcd", "ent", "fdf", "gro",
  "in", "inp", "lammpstrj", "mae", "mae.gz", "maegz", "mcif", "mmcif", "mol",
  "mol2", "nctraj", "nw", "out", "pdb", "pdbqt", "pqr", "prmtop", "psf", "psi4", "qcin",
  "sd", "sdf", "smi", "smiles", "top", "trr", "tsv", "vasp", "xtc", "xyz",
]);
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
  if (lower.endsWith(".mae.gz")) return "mae.gz";
  const index = lower.lastIndexOf(".");
  return index >= 0 ? lower.slice(index + 1) : "";
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

export default defineConfig({
  root: desktopRoot,
  plugins: [react(), browserDevXyzrenderPlugin()],
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
    fs: { allow: [repoRoot, ...defaultFsAllow, ...extraFsAllow] },
    watch: { ignored: ["src-tauri/target/**"] },
  },
  build: {
    outDir: desktopDist,
    emptyOutDir: true,
  },
  clearScreen: false,
});
