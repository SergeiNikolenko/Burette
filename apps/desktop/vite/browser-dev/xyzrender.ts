import { createXyzrenderWorker } from "./xyzrender-worker";
import { rotateXyzrenderReference } from "./xyzrender-orientation";
import { xyzrenderAnimationArguments } from "./xyzrender-animation-options";
import { registerXyzrenderExportRoute } from "./xyzrender-export";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { ViteDevServer } from "vite";

import { readJsonBody, sendJson, sendJsonError } from "./http";

type ExecFileAsync = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
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

function activeModelIndex(value: unknown): number | null {
  if (value == null || value === "") return null;
  const index = Number(value);
  return Number.isFinite(index) && index >= 0 ? Math.trunc(index) : null;
}

function splitXyzFrameTexts(data: Uint8Array): string[] {
  const text = new TextDecoder().decode(data).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  const frames: string[] = [];
  let index = 0;
  while (index < lines.length && frames.length < 100000) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    const atomCount = Number.parseInt(lines[index]?.trim().split(/\s+/u)[0] ?? "", 10);
    if (!Number.isFinite(atomCount) || atomCount <= 0) break;
    if (index + atomCount + 1 >= lines.length) break;
    const frameLines = lines.slice(index, index + atomCount + 2);
    const atomLines = frameLines.slice(2);
    if (atomLines.length !== atomCount || atomLines.some((line) => !line.trim())) break;
    frames.push(`${frameLines.join("\n")}\n`);
    index += atomCount + 2;
  }
  return frames.length > 1 ? frames : [];
}

export function selectedXyzFrameInputData(
  data: Uint8Array | null,
  inputExtension: string,
  activeModel: unknown,
): Uint8Array | null {
  const index = activeModelIndex(activeModel);
  if (!data?.length || inputExtension !== "xyz" || index === null) return null;
  const frames = splitXyzFrameTexts(data);
  if (frames.length <= 1) return null;
  const frame = frames[Math.max(0, Math.min(frames.length - 1, index))];
  return new TextEncoder().encode(frame);
}

export function registerBrowserDevXyzrenderRoute(server: ViteDevServer, options: BrowserDevXyzrenderRouteOptions) {
  const worker = createXyzrenderWorker();
  server.httpServer?.once("close", worker.stop);
  registerXyzrenderExportRoute(server);
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
      let orientationRef = options.normalizeOrientationRef(typeof body.orientationRef === "string" ? body.orientationRef : null);
      const controls = options.normalizeControls(body.controls);
      if (body.orientation !== undefined) {
        try { rotateXyzrenderReference('1\nvalidate\nH 0 0 0\n', body.orientation); }
        catch (error) { sendJson(res, 400, { error: String(error) }); return; }
      }
      const inputData = typeof body.inputDataBase64 === "string"
        ? Buffer.from(body.inputDataBase64, "base64")
        : null;
      const inputExtension = options.normalizeInputExtension(typeof body.inputExtension === "string" ? body.inputExtension : null);
      const animation = body.animation;
      const exportFormat = body.exportFormat;
      if (exportFormat !== undefined && !['svg', 'png', 'pdf', 'tiff'].includes(String(exportFormat))) { sendJson(res, 400, { error: 'Unsupported export format' }); return; }
      try { if (animation) xyzrenderAnimationArguments(animation, 'animation.gif'); }
      catch (error) { sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }); return; }
      const activeModel = animation ? null : activeModelIndex(body.activeModel);
      const executable = options.resolveExecutable();
      if (!executable) {
        sendJson(res, 404, { error: "External xyzrender executable was not found." });
        return;
      }
      const tempDirectory = await mkdtemp(join(tmpdir(), "burette-xyzrender-"));
      const outputPath = join(tempDirectory, "xyzrender.svg");
      const convertedInputPath = join(tempDirectory, `xyzrender-input.${inputExtension}`);
      const orientationRefPath = join(tempDirectory, "orientation-ref.xyz");
      const startedAt = Date.now();
      const renderAbort = new AbortController();
      const onClose = () => { if (!res.writableEnded) renderAbort.abort(); };
      res.on("close", onClose);
      try {
        const pathInputData = !inputData?.length && activeModel !== null && inputExtension === "xyz"
          ? await readFile(inputPath)
          : null;
        const selectedFrameInputData = selectedXyzFrameInputData(inputData ?? pathInputData, inputExtension, activeModel);
        const effectiveInputData = selectedFrameInputData ?? inputData;
        let effectiveInputPath = effectiveInputData?.length ? convertedInputPath : inputPath;
        if (effectiveInputData?.length) {
          await writeFile(convertedInputPath, effectiveInputData);
        } else if (animation) {
          // Vibration extraction writes .vNNN.xyz beside its input. Never let
          // a preview overwrite a user's trajectory beside the calculation.
          effectiveInputPath = join(tempDirectory, `animation-input${extname(inputPath)}`);
          await writeFile(effectiveInputPath, await readFile(inputPath));
        }
        if (animation?.mode === 'trajectory' && extname(effectiveInputPath).toLowerCase() === '.xyz' && splitXyzFrameTexts(await readFile(effectiveInputPath)).length < 2) {
          sendJson(res, 422, { error: 'Trajectory needs at least two coordinate frames. This file contains one structure.', code: 'animation_unavailable' });
          return;
        }
        if (orientationRef) {
          await writeFile(orientationRefPath, orientationRef, "utf8");
        }
        const execute = async (refPath: string | null) => {
          const args = options.buildArgs(effectiveInputPath, outputPath, preset, refPath, controls);
          if (animation) {
            args.push(...xyzrenderAnimationArguments(animation, join(tempDirectory, 'animation.gif')));
          }
          if (!animation) {
            const rendered = await worker.run(executable, args, renderAbort.signal);
            if (rendered) return rendered;
          }
          return options.execFileAsync(
            executable,
            args,
            { timeout: animation ? 120_000 : XYZRENDER_BROWSER_DEV_TIMEOUT, maxBuffer: XYZRENDER_BROWSER_DEV_MAX_BUFFER, signal: renderAbort.signal,
              // Avoid spawning one Python interpreter per logical CPU for a
              // small interactive GIF. Explicit user tuning takes precedence.
              env: animation ? { ...process.env, PYTHON_CPU_COUNT: process.env.PYTHON_CPU_COUNT || '4',
                OPENBLAS_NUM_THREADS: process.env.OPENBLAS_NUM_THREADS || '1', OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '1' } : process.env },
          );
        };
        let baseOrientationRef = orientationRef;
        let initialRender: { stdout: string; stderr: string } | undefined;
        if (body.orientation !== undefined) {
          if (!baseOrientationRef) {
            const baseArgs = options.buildArgs(effectiveInputPath, outputPath, preset, orientationRefPath, controls);
            initialRender = await options.execFileAsync(executable, baseArgs, { timeout: XYZRENDER_BROWSER_DEV_TIMEOUT, maxBuffer: XYZRENDER_BROWSER_DEV_MAX_BUFFER, signal: renderAbort.signal });
            baseOrientationRef = await readFile(orientationRefPath, 'utf8');
          }
          orientationRef = rotateXyzrenderReference(baseOrientationRef, body.orientation);
          await writeFile(orientationRefPath, orientationRef, 'utf8');
        }
        let fallbackLog = "";
        let stdout = "";
        let stderr = "";
        try {
          const result = initialRender && Array.isArray(body.orientation) && body.orientation.every(angle => angle === 0) && !animation
            ? initialRender : await execute(orientationRef ? orientationRefPath : null);
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
        let artifactBase64: string | undefined;
        if (exportFormat) {
          if (exportFormat === 'svg') artifactBase64 = Buffer.from(svg).toString('base64');
          else {
            const exportPath = join(tempDirectory, `figure.${exportFormat}`);
            await options.execFileAsync(executable, options.buildArgs(effectiveInputPath, exportPath, preset, orientationRef ? orientationRefPath : null, controls),
              { timeout: XYZRENDER_BROWSER_DEV_TIMEOUT, maxBuffer: XYZRENDER_BROWSER_DEV_MAX_BUFFER, signal: renderAbort.signal,
                // CairoSVG uses dlopen for PDF output; Homebrew's libraries are
                // outside macOS' default loader search path in desktop shells.
                env: exportFormat === 'pdf' && process.platform === 'darwin' ? { ...process.env,
                  DYLD_FALLBACK_LIBRARY_PATH: [process.env.DYLD_FALLBACK_LIBRARY_PATH, '/opt/homebrew/lib', '/usr/local/lib'].filter(Boolean).join(':') } : process.env });
            const artifact = await readFile(exportPath);
            if (artifact.length > 16 * 1024 * 1024) throw new Error('Export exceeds 16 MB. Choose a smaller image.');
            artifactBase64 = artifact.toString('base64');
          }
        }
        const gif = animation ? await readFile(join(tempDirectory, 'animation.gif')) : null;
        if (gif && gif.length > 16 * 1024 * 1024) throw new Error('Animation exceeds the 16 MB preview limit.');
        sendJson(res, 200, {
          svg,
          orientationRef,
          baseOrientationRef,
          artifactBase64,
          exportFormat,
          gifBase64: gif?.toString('base64'),
          preset: options.resolveEffectivePreset(preset, controls),
          configArgument: options.resolveConfigArgument(preset, controls),
          elapsedMs: Date.now() - startedAt,
          log: `${fallbackLog}${stdout}${stderr}`,
          activeModel: activeModel ?? undefined,
          xyzrenderControls: controls,
          xyzrenderPresetOptions: options.presetOptions,
        });
      } finally {
        res.off("close", onClose);
        await rm(tempDirectory, { recursive: true, force: true });
      }
    } catch (error) {
      sendJsonError(res, 500, error);
    }
  });
}
