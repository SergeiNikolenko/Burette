#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const shouldBuild = process.argv.includes("--build");
const home = process.env.HOME;

if (!home) {
  throw new Error("HOME is not set.");
}

const marketplaceName = "burrete";
const marketplaceRoot = path.join(home, ".codex", "plugins", "burrete-marketplace");
const marketplacePath = path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json");
const personalPluginRoot = path.join(marketplaceRoot, "plugins", "burrete");
const codexConfigPath = path.join(home, ".codex", "config.toml");
const legacyMarketplacePath = path.join(home, ".agents", "plugins", "marketplace.json");
const pluginVersion = await readPluginVersion();
const pluginId = `burrete@${marketplaceName}`;
const installRoot = path.join(home, ".codex", "plugins", "cache", marketplaceName, "burrete", pluginVersion);
const requiredBundleFiles = [
  "browser-shell-dist/boot-overlay.js",
  "browser-shell-dist/index.html",
  "browser-shell-dist/index.js",
  "preview-web/index.html",
  "preview-web/viewer.js",
  "preview-web/viewer-bootstrap.js",
  "preview-web/viewer-shell.js",
  "preview-web/viewer-runtime.css",
  "preview-web/trajectory-smoothing.js",
  "preview-web/molstar.js",
  "preview-web/molstar.css",
  "preview-web/burette-agent.js",
  "preview-web/grid-viewer.js",
  "preview-web/grid-ui.js",
  "preview-web/grid.css",
  "preview-web/openchemlib/openchemlib.js",
  "preview-web/rdkit/RDKit_minimal.js",
  "preview-web/rdkit/RDKit_minimal.wasm",
  "scripts/agent-preview.mjs",
  "scripts/agent-shell-server.mjs",
  "scripts/burrete-agent.mjs",
  "mcp/lib/server-bundle.mjs",
];

if (isSourceCheckout() && (shouldBuild || missingBundleFiles().length > 0)) {
  await run("bun", ["run", "build:agent-shell"], { cwd: repoRoot });
}

const missingFiles = missingBundleFiles();
if (missingFiles.length > 0) {
  throw new Error(`Incomplete Burrete plugin bundle. Missing: ${missingFiles.join(", ")}. Run bun run build:agent-shell before installing.`);
}

await rm(personalPluginRoot, { recursive: true, force: true });
await mkdir(personalPluginRoot, { recursive: true });
await run("rsync", [
  "-a",
  "--delete",
  "--exclude", "node_modules",
  "--exclude", "mcp/lib/tool-response 2.mjs",
  `${pluginRoot}/`,
  `${personalPluginRoot}/`,
], { cwd: repoRoot });
await writeFile(path.join(personalPluginRoot, ".burette-agent-install.json"), `${JSON.stringify({ repoRoot }, null, 2)}\n`);
await updateMarketplace();
const codexBinary = findWorkingCodexBinary();
const installation = codexBinary ? installWithCodex(codexBinary) : await installWithoutCodexCli();
const legacyCleanup = await cleanupLegacySources();

console.log(JSON.stringify({
  ok: true,
  plugin: pluginId,
  version: pluginVersion,
  marketplaceName,
  marketplaceRoot,
  sourceRoot: personalPluginRoot,
  installRoot: installation.installedPath,
  marketplacePath,
  codexConfigPath,
  installationMethod: installation.method,
  migratedPluginIds: installation.migratedPluginIds,
  legacyCleanup,
  codexBinary,
  restartRequired: true,
  note: "Restart Codex so the plugin and MCP server are reloaded.",
}, null, 2));

function isSourceCheckout() {
  return existsSync(path.join(repoRoot, "package.json"))
    && existsSync(path.join(repoRoot, "scripts", "build-agent-shell-plugin.mjs"))
    && existsSync(path.join(repoRoot, "apps", "desktop", "vite.config.ts"));
}

function missingBundleFiles() {
  const requiredFiles = new Set(requiredBundleFiles);
  for (const entrypoint of ["browser-shell-dist/index.html", "browser-shell-dist/index.js"]) {
    const entrypointPath = path.join(pluginRoot, entrypoint);
    if (!existsSync(entrypointPath)) continue;
    const source = readFileSync(entrypointPath, "utf8");
    for (const match of source.matchAll(/["'`](?:\.\/)?(assets\/[^"'`?#\s]+)["'`]/gu)) {
      const reference = path.posix.normalize(match[1]);
      if (!reference.startsWith("assets/")) continue;
      requiredFiles.add(path.posix.join("browser-shell-dist", reference));
    }
  }
  const serverBundlePath = path.join(pluginRoot, "mcp/lib/server-bundle.mjs");
  if (existsSync(serverBundlePath)) {
    const source = readFileSync(serverBundlePath, "utf8");
    for (const match of source.matchAll(/["']\.\/(server-chunk-[^"'/?#\s]+\.mjs)["']/gu)) {
      requiredFiles.add(path.posix.join("mcp/lib", match[1]));
    }
  }
  return [...requiredFiles].filter(relativePath => !existsSync(path.join(pluginRoot, relativePath)));
}

async function updateMarketplace() {
  await mkdir(path.dirname(marketplacePath), { recursive: true });
  const data = {
    name: marketplaceName,
    interface: { displayName: "Burrete" },
    plugins: [{
      name: "burrete",
      source: { source: "local", path: "./plugins/burrete" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL", products: ["CODEX"] },
      category: "Education & Research",
    }],
  };
  await writeFile(marketplacePath, `${JSON.stringify(data, null, 2)}\n`);
}

function installWithCodex(command) {
  runCodexJson(command, ["plugin", "marketplace", "add", marketplaceRoot, "--json"], "marketplace registration");
  const payload = runCodexJson(command, ["plugin", "add", pluginId, "--json"], "plugin installation");
  const installed = runCodexJson(command, ["plugin", "list", "--json"], "plugin inventory").installed || [];
  const migratedPluginIds = installed
    .filter((plugin) => plugin.name === "burrete" && plugin.pluginId !== pluginId)
    .map((plugin) => plugin.pluginId);
  for (const legacyPluginId of migratedPluginIds) {
    runCodexJson(command, ["plugin", "remove", legacyPluginId, "--json"], `legacy plugin removal (${legacyPluginId})`);
  }
  return {
    method: "codex-cli",
    installedPath: payload.installedPath || installRoot,
    migratedPluginIds,
  };
}

function runCodexJson(command, args, label) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Codex ${label} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Codex ${label} returned invalid JSON.`);
  }
}

async function installWithoutCodexCli() {
  await rm(path.dirname(installRoot), { recursive: true, force: true });
  await mkdir(installRoot, { recursive: true });
  await run("rsync", ["-a", "--delete", `${personalPluginRoot}/`, `${installRoot}/`], { cwd: repoRoot });
  await updateCodexConfig();
  return {
    method: "cache-fallback",
    installedPath: installRoot,
    migratedPluginIds: [],
  };
}

async function cleanupLegacySources() {
  let marketplaceEntryRemoved = false;
  if (existsSync(legacyMarketplacePath)) {
    try {
      const data = JSON.parse(await readFile(legacyMarketplacePath, "utf8"));
      const plugins = Array.isArray(data.plugins) ? data.plugins : [];
      const filteredPlugins = plugins.filter((plugin) => plugin.name !== "burrete");
      if (filteredPlugins.length !== plugins.length) {
        data.plugins = filteredPlugins;
        await writeFile(legacyMarketplacePath, `${JSON.stringify(data, null, 2)}\n`);
        marketplaceEntryRemoved = true;
      }
    } catch {
      // Preserve an invalid or externally managed marketplace file.
    }
  }
  return { marketplaceEntryRemoved };
}

async function updateCodexConfig() {
  await mkdir(path.dirname(codexConfigPath), { recursive: true });
  const existing = existsSync(codexConfigPath) ? await readFile(codexConfigPath, "utf8") : "";
  const oldBlockPattern = /\n?\[plugins\."burrete@[^"]+"\]\n(?:[^\n\[]*\n)*/gu;
  const cleaned = existing.replace(oldBlockPattern, "\n").replace(/\n{3,}/gu, "\n\n");
  if (new RegExp(`^\\[plugins\\."${escapeRegExp(pluginId)}"\\]`, "mu").test(cleaned)) return;
  const next = `${cleaned.replace(/\s*$/u, "")}\n\n[plugins."${pluginId}"]\nenabled = true\n`;
  await writeFile(codexConfigPath, next);
}

async function readPluginVersion() {
  const manifest = JSON.parse(await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
  if (!version || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(version)) {
    throw new Error("The plugin manifest has an invalid version.");
  }
  return version;
}

function findWorkingCodexBinary() {
  const candidates = [
    process.env.BURRETE_CODEX_BIN,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    "codex",
  ].filter(Boolean);
  for (const candidate of new Set(candidates)) {
    if (path.isAbsolute(candidate) && !existsSync(candidate)) continue;
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function run(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${command} ${args.join(" ")} failed with ${signal || code}`));
    });
  });
}
