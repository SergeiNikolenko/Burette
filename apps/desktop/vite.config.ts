import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const desktopDist = fileURLToPath(new URL("dist", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const extraFsAllow = (process.env.BURRETE_DEV_FS_ALLOW ?? "").split(delimiter).filter(Boolean);
const execFileAsync = promisify(execFile);
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

function sanitizedExtraArguments(value: string | null) {
  if (!value) return [];
  const blocked = new Set(["-o", "--output", "-go", "--gif-output", "--config", "--ref"]);
  const blockedPrefixes = [...blocked].map((flag) => `${flag}=`);
  const result: string[] = [];
  let skipNext = false;
  for (const token of splitCommandLine(value)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (blocked.has(token)) {
      skipNext = true;
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
  args.push(...sanitizedExtraArguments(controls.extraArguments));
  return args;
}

function normalizeXyzrenderPreset(value: string | null) {
  const normalized = String(value || "default").trim().toLowerCase();
  return XYZRENDER_PRESET_OPTIONS.some((option) => option.value === normalized) ? normalized : "default";
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

function browserDevXyzrenderPlugin() {
  return {
    name: "burrete-browser-dev-xyzrender",
    configureServer(server: import("vite").ViteDevServer) {
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
          const executable = resolveXyzrenderExecutable();
          if (!executable) {
            reply(404, { error: "External xyzrender executable was not found." });
            return;
          }
          const tempDirectory = await mkdtemp(join(tmpdir(), "burrete-xyzrender-"));
          const outputPath = join(tempDirectory, "xyzrender.svg");
          const orientationRefPath = join(tempDirectory, "orientation-ref.xyz");
          const startedAt = Date.now();
          try {
            const args = buildXyzrenderArgs(
              inputPath,
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
  define: {
    "import.meta.env.BURRETE_REPO_ROOT": JSON.stringify(repoRoot),
  },
  server: {
    port: 1420,
    strictPort: true,
    fs: { allow: [repoRoot, ...extraFsAllow] },
    watch: { ignored: ["src-tauri/target/**"] },
  },
  build: {
    outDir: desktopDist,
    emptyOutDir: true,
  },
  clearScreen: false,
});
