import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

type ExecFileAsync = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout?: string; stderr?: string }>;

const XYZRENDER_REF_UNSUPPORTED_FOR_PERIODIC = "--ref is not supported for periodic structures";
const XYZRENDER_BROWSER_DEV_TIMEOUT = 25_000;
const XYZRENDER_BROWSER_DEV_MAX_BUFFER = 8 * 1024 * 1024;

type BrowserDevXyzrenderRouteOptions = {
  buildArgs: (
    inputPath: string,
    outputPath: string,
    preset: string,
    orientationRefPath: string | null,
    controls: any,
  ) => string[];
  execFileAsync: ExecFileAsync;
  normalizeControls: (value: unknown) => any;
  normalizeInputExtension: (value: string | null) => string;
  normalizeOrientationRef: (value: string | null) => string | null;
  normalizePreset: (value: string | null) => string;
  presetOptions: unknown;
  resolveConfigArgument: (preset: string, controls: any) => unknown;
  resolveEffectivePreset: (preset: string, controls: any) => unknown;
  resolveExecutable: () => string | null;
};

function isXyzrenderRefUnsupportedForPeriodic(error: unknown): boolean {
  const details = error && typeof error === "object"
    ? error as { message?: unknown; stdout?: unknown; stderr?: unknown }
    : { message: error };
  return [details.message, details.stdout, details.stderr]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .includes(XYZRENDER_REF_UNSUPPORTED_FOR_PERIODIC);
}

export function registerBrowserDevXyzrenderRoute(server: ViteDevServer, options: BrowserDevXyzrenderRouteOptions) {
  server.middlewares.use("/__burette/xyzrender", async (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const inputPath = typeof body.path === "string" ? body.path : null;
      if (!inputPath) {
        sendJson(res, 400, { error: "Missing path" });
        return;
      }
      const preset = options.normalizePreset(typeof body.preset === "string" ? body.preset : null);
      const orientationRef = options.normalizeOrientationRef(typeof body.orientationRef === "string" ? body.orientationRef : null);
      const controls = options.normalizeControls(body.controls);
      const inputData = typeof body.inputDataBase64 === "string"
        ? Buffer.from(body.inputDataBase64, "base64")
        : null;
      const inputExtension = options.normalizeInputExtension(typeof body.inputExtension === "string" ? body.inputExtension : null);
      const executable = options.resolveExecutable();
      if (!executable) {
        sendJson(res, 404, { error: "External xyzrender executable was not found." });
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
        if (orientationRef) {
          await writeFile(orientationRefPath, orientationRef, "utf8");
        }
        const execute = async (refPath: string | null) => {
          const args = options.buildArgs(effectiveInputPath, outputPath, preset, refPath, controls);
          return options.execFileAsync(
            executable,
            args,
            { timeout: XYZRENDER_BROWSER_DEV_TIMEOUT, maxBuffer: XYZRENDER_BROWSER_DEV_MAX_BUFFER },
          );
        };
        let fallbackLog = "";
        let stdout = "";
        let stderr = "";
        try {
          const result = await execute(orientationRef ? orientationRefPath : null);
          stdout = result.stdout || "";
          stderr = result.stderr || "";
        } catch (error) {
          if (!orientationRef || !isXyzrenderRefUnsupportedForPeriodic(error)) {
            throw error;
          }
          await rm(outputPath, { force: true });
          fallbackLog = "[burette] Retried without --ref because xyzrender does not support --ref for periodic structures.\n";
          const result = await execute(null);
          stdout = result.stdout || "";
          stderr = result.stderr || "";
        }
        const svg = await readFile(outputPath, "utf8");
        if (!svg.trim()) {
          sendJson(res, 500, { error: "External xyzrender produced an empty SVG output file." });
          return;
        }
        sendJson(res, 200, {
          svg,
          preset: options.resolveEffectivePreset(preset, controls),
          configArgument: options.resolveConfigArgument(preset, controls),
          elapsedMs: Date.now() - startedAt,
          log: `${fallbackLog}${stdout}${stderr}`,
          xyzrenderControls: controls,
          xyzrenderPresetOptions: options.presetOptions,
        });
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}
