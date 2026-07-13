import { existsSync, readFileSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export type BrowserDevXtbSource = "selected" | "managed" | "conda" | "pixi" | "homebrew" | "path";

export type BrowserDevXtbResolution = {
  executablePath: string;
  selectedExecutablePath: string | null;
  source: BrowserDevXtbSource;
};

type RuntimeConfig = { selectedExecutablePath?: unknown };

const runtimeRoot = join(homedir(), "Library", "Application Support", "Burrete", "browser-dev", "runtimes", "xtb");
const configPath = join(runtimeRoot, "config.json");
const pixiManifest = readFileSync(fileURLToPath(new URL("../../../../config/xtb/pixi.toml", import.meta.url)), "utf8");
const pixiLock = readFileSync(fileURLToPath(new URL("../../../../config/xtb/pixi.lock", import.meta.url)), "utf8");
const execFileAsync = promisify(execFile);
let managedInstall: Promise<BrowserDevXtbResolution> | null = null;

export function resolveBrowserDevXtb(): BrowserDevXtbResolution {
  const environmentSelection = process.env.BURRETE_XTB_EXECUTABLE?.trim();
  const persistedSelection = readSelection();
  const selected = environmentSelection || persistedSelection;
  if (selected) {
    validateExecutable(selected);
    return { executablePath: selected, selectedExecutablePath: selected, source: "selected" };
  }

  for (const [path, source] of automaticCandidates()) {
    if (isExecutableFile(path)) {
      return { executablePath: path, selectedExecutablePath: null, source };
    }
  }
  throw new Error("xTB was not found. Choose an existing xTB executable in Settings or install a Burrete-managed copy.");
}

export async function selectBrowserDevXtb(executablePath: unknown): Promise<void> {
  const selected = typeof executablePath === "string" && executablePath.trim() ? executablePath.trim() : null;
  if (selected) validateExecutable(selected);
  await mkdir(runtimeRoot, { recursive: true });
  const temporary = `${configPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ selectedExecutablePath: selected }, null, 2)}\n`, "utf8");
  await rename(temporary, configPath);
}

export function installBrowserDevManagedXtb(): Promise<BrowserDevXtbResolution> {
  if (managedInstall) return managedInstall;
  managedInstall = installManaged().finally(() => {
    managedInstall = null;
  });
  return managedInstall;
}

export function browserDevXtbRuntimeRoot() {
  return runtimeRoot;
}

function readSelection(): string | null {
  if (!existsSync(configPath)) return null;
  let payload: RuntimeConfig;
  try {
    payload = JSON.parse(readFileSync(configPath, "utf8")) as RuntimeConfig;
  } catch (error) {
    throw new Error(`Could not read ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return typeof payload.selectedExecutablePath === "string" && payload.selectedExecutablePath.trim()
    ? payload.selectedExecutablePath.trim()
    : null;
}

function automaticCandidates(): Array<[string, BrowserDevXtbSource]> {
  const candidates: Array<[string, BrowserDevXtbSource]> = [
    [join(runtimeRoot, "current", ".pixi", "envs", "default", "bin", "xtb"), "managed"],
  ];
  if (process.env.CONDA_PREFIX) candidates.push([join(process.env.CONDA_PREFIX, "bin", "xtb"), "conda"]);
  for (const directory of ["miniconda3", "miniforge3", "mambaforge", "anaconda3"]) {
    candidates.push([join(homedir(), directory, "bin", "xtb"), "conda"]);
  }
  candidates.push([join(homedir(), ".pixi", "bin", "xtb"), "pixi"]);
  candidates.push([join(homedir(), ".local", "bin", "xtb"), "path"]);
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    candidates.push([join(directory, "xtb"), "path"]);
  }
  candidates.push(["/opt/homebrew/bin/xtb", "homebrew"]);
  candidates.push(["/usr/local/bin/xtb", "homebrew"]);
  return candidates;
}

async function installManaged(): Promise<BrowserDevXtbResolution> {
  const pixi = resolvePixi();
  if (!pixi) {
    throw new Error("Managed xTB installation requires Pixi. Install Pixi, or choose an existing xTB executable in Settings.");
  }
  await mkdir(runtimeRoot, { recursive: true });
  const staging = join(runtimeRoot, `staging-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(staging, { recursive: true });
  try {
    const manifestPath = join(staging, "pixi.toml");
    await writeFile(manifestPath, pixiManifest, "utf8");
    await writeFile(join(staging, "pixi.lock"), pixiLock, "utf8");
    await execFileAsync(pixi, ["install", "--locked", "--manifest-path", manifestPath], {
      timeout: 5 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    validateExecutable(join(staging, ".pixi", "envs", "default", "bin", "xtb"));
    await promoteStagedRuntime(staging);
    await selectBrowserDevXtb(null);
    return resolveBrowserDevXtb();
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function promoteStagedRuntime(staging: string) {
  const current = join(runtimeRoot, "current");
  const previous = join(runtimeRoot, "previous");
  await rm(previous, { recursive: true, force: true });
  if (existsSync(current)) await rename(current, previous);
  try {
    await rename(staging, current);
  } catch (error) {
    if (existsSync(previous)) await rename(previous, current);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}

function resolvePixi() {
  const candidates = [
    join(homedir(), ".pixi", "bin", "pixi"),
    join(homedir(), ".local", "bin", "pixi"),
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => join(directory, "pixi")),
    "/opt/homebrew/bin/pixi",
    "/usr/local/bin/pixi",
  ];
  return candidates.find(isExecutableFile) ?? null;
}

function validateExecutable(path: string) {
  if (!isAbsolute(path)) throw new Error("The xTB executable path must be absolute.");
  if (!isExecutableFile(path)) throw new Error(`${path} is not an executable file.`);
}

function isExecutableFile(path: string) {
  try {
    const metadata = statSync(path);
    return metadata.isFile() && (metadata.mode & 0o111) !== 0;
  } catch (_) {
    return false;
  }
}
