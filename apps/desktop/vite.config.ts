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
            const args = [inputPath, "-o", outputPath, "--config", preset];
            if (orientationRef) {
              await writeFile(orientationRefPath, orientationRef, "utf8");
              args.push("--ref", orientationRefPath);
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
              preset,
              configArgument: preset,
              elapsedMs: Date.now() - startedAt,
              log: `${stdout || ""}${stderr || ""}`,
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
