import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { mkdir, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export type BrowserDevXtbSource = "selected" | "managed" | "conda" | "pixi" | "homebrew" | "path";

export type BrowserDevXtbResolution = {
  executablePath: string;
  selectedExecutablePath: string | null;
  source: BrowserDevXtbSource;
};

type RuntimeConfig = { selectedExecutablePath?: unknown };
type BrowserDevManagedInstaller = { kind: "pixi" | "conda"; executablePath: string };

const runtimeRoot = join(homedir(), "Library", "Application Support", "Burette", "browser-dev", "runtimes", "xtb");
const configPath = join(runtimeRoot, "config.json");
const pixiManifest = readFileSync(fileURLToPath(new URL("../../../../config/xtb/pixi.toml", import.meta.url)), "utf8");
const pixiLock = readFileSync(fileURLToPath(new URL("../../../../config/xtb/pixi.lock", import.meta.url)), "utf8");
const execFileAsync = promisify(execFile);
let managedInstall: Promise<BrowserDevXtbResolution> | null = null;
let selectionRevision = 0;

export function resolveBrowserDevXtb(): BrowserDevXtbResolution {
  const selected = selectedBrowserDevXtbPath();
  if (selected) {
    validateXtbExecutable(selected);
    return { executablePath: selected, selectedExecutablePath: selected, source: "selected" };
  }

  for (const [path, source] of automaticCandidates()) {
    if (isValidXtbExecutable(path)) {
      return { executablePath: realpathSync(path), selectedExecutablePath: null, source };
    }
  }
  throw new Error("xTB was not found. Choose an existing xTB executable in Settings or install a Burette-managed copy.");
}

export function selectedBrowserDevXtbPath() {
  return process.env.BURETTE_XTB_EXECUTABLE?.trim() || readSelection();
}

export async function selectBrowserDevXtb(executablePath: unknown): Promise<void> {
  const revision = ++selectionRevision;
  const selected = typeof executablePath === "string" && executablePath.trim() ? executablePath.trim() : null;
  if (selected) validateXtbExecutable(selected);
  await mkdir(runtimeRoot, { recursive: true });
  const temporary = `${configPath}.${revision}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ selectedExecutablePath: selected }, null, 2)}\n`, "utf8");
  if (revision !== selectionRevision) {
    await rm(temporary, { force: true });
    return;
  }
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

export function browserDevManagedInstallerName() {
  return resolveManagedInstaller()?.kind ?? null;
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
  await cleanupInactiveManagedRuntimes();
  const selectionBefore = selectionRevision;
  const managed = join(runtimeRoot, "current", ".pixi", "envs", "default", "bin", "xtb");
  if (isValidXtbExecutable(managed)) {
    if (selectionRevision === selectionBefore) await selectBrowserDevXtb(null);
    return resolveBrowserDevXtb();
  }
  const installer = resolveManagedInstaller();
  if (!installer) {
    throw new Error("Managed xTB installation requires Pixi or Conda. Install either package manager, or choose an existing xTB executable in Settings.");
  }
  await mkdir(runtimeRoot, { recursive: true });
  const staging = join(runtimeRoot, `staging-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(staging, { recursive: true });
  try {
    await installIntoStaging(installer, staging);
    validateXtbExecutable(join(staging, ".pixi", "envs", "default", "bin", "xtb"));
    await promoteStagedRuntime(staging);
    if (selectionRevision === selectionBefore) await selectBrowserDevXtb(null);
    return resolveBrowserDevXtb();
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function cleanupInactiveManagedRuntimes() {
  if (!existsSync(runtimeRoot)) return;
  let active: string | null = null;
  try {
    active = realpathSync(join(runtimeRoot, "current"));
  } catch (_) {
    active = null;
  }
  const cutoff = Date.now() - 48 * 60 * 60_000;
  for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || (!entry.name.startsWith("staging-") && !entry.name.startsWith("legacy-"))) continue;
    const path = join(runtimeRoot, entry.name);
    if (path === active || statSync(path).mtimeMs > cutoff) continue;
    await rm(path, { recursive: true, force: true });
  }
}

async function promoteStagedRuntime(staging: string) {
  const current = join(runtimeRoot, "current");
  const next = join(runtimeRoot, "current.next");
  await rm(next, { force: true });
  await symlink(basename(staging), next, "dir");
  let legacy: string | null = null;
  if (existsSync(current)) {
    const metadata = lstatSync(current);
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      legacy = join(runtimeRoot, `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await rename(current, legacy);
    }
  }
  try {
    await rename(next, current);
  } catch (error) {
    if (legacy) await rename(legacy, current).catch(() => undefined);
    throw error;
  }
}

function resolvePixi() {
  const candidates = [
    join(homedir(), ".pixi", "bin", "pixi"),
    join(homedir(), ".local", "bin", "pixi"),
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => join(directory, "pixi")),
    "/opt/homebrew/bin/pixi",
    "/usr/local/bin/pixi",
  ];
  return firstAbsoluteExecutable(candidates);
}

function resolveConda() {
  const candidates = [
    process.env.CONDA_EXE ?? "",
    ...["miniconda3", "miniforge3", "mambaforge", "anaconda3"].flatMap((directory) => [
      join(homedir(), directory, "bin", "conda"),
      join(homedir(), directory, "bin", "mamba"),
    ]),
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).flatMap((directory) => [
      join(directory, "conda"),
      join(directory, "mamba"),
    ]),
    "/opt/homebrew/bin/conda",
    "/opt/homebrew/bin/mamba",
    "/usr/local/bin/conda",
    "/usr/local/bin/mamba",
  ].filter(Boolean);
  return firstAbsoluteExecutable(candidates);
}

function firstAbsoluteExecutable(candidates: string[]) {
  return candidates.find((path) => isAbsolute(path) && isExecutableFile(path)) ?? null;
}

function resolveManagedInstaller(): BrowserDevManagedInstaller | null {
  const pixi = resolvePixi();
  if (pixi) return { kind: "pixi", executablePath: pixi };
  const conda = resolveConda();
  return conda ? { kind: "conda", executablePath: conda } : null;
}

async function installIntoStaging(installer: BrowserDevManagedInstaller, staging: string) {
  if (installer.kind === "pixi") {
    const manifestPath = join(staging, "pixi.toml");
    await writeFile(manifestPath, pixiManifest, "utf8");
    await writeFile(join(staging, "pixi.lock"), pixiLock, "utf8");
    await execFileAsync(installer.executablePath, ["install", "--locked", "--manifest-path", manifestPath], {
      timeout: 5 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return;
  }

  const environment = join(staging, ".pixi", "envs", "default");
  await mkdir(join(staging, ".pixi", "envs"), { recursive: true });
  await execFileAsync(installer.executablePath, [
    "create", "--yes", "--no-default-packages", "--override-channels",
    "--channel", "conda-forge", "--prefix", environment, "xtb=6.7.*",
  ], {
    timeout: 5 * 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function validateExecutable(path: string) {
  if (!isAbsolute(path)) throw new Error("The xTB executable path must be absolute.");
  if (!isExecutableFile(path)) throw new Error(`${path} is not an executable file.`);
}

function validateXtbExecutable(path: string) {
  validateExecutable(path);
  const probe = spawnSync(path, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 128 * 1024,
  });
  const output = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
  if (probe.status !== 0 || !/\bxtb version\b/iu.test(output)) {
    const detail = probe.error?.message
      || `exit ${probe.status ?? "unknown"}${probe.signal ? `, signal ${probe.signal}` : ""}: ${output.trim().slice(0, 500) || "no output"}`;
    throw new Error(`${path} did not report a valid xTB version (${detail}).`);
  }
}

function isValidXtbExecutable(path: string) {
  try {
    validateXtbExecutable(path);
    return true;
  } catch (_) {
    return false;
  }
}

function isExecutableFile(path: string) {
  try {
    const metadata = statSync(path);
    return metadata.isFile() && (metadata.mode & 0o111) !== 0;
  } catch (_) {
    return false;
  }
}
