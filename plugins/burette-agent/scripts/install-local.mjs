#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

if (shouldBuild && isSourceCheckout()) {
  await run("bun", ["run", "build:agent-shell"], { cwd: repoRoot });
}

if (!existsSync(path.join(pluginRoot, "browser-shell-dist", "index.html"))) {
  throw new Error("Missing browser-shell-dist/index.html. Run bun run build:agent-shell before installing, or install from a prebuilt plugin bundle.");
}
if (!existsSync(path.join(pluginRoot, "preview-web", "index.html"))) {
  throw new Error("Missing preview-web/index.html. Run bun run build:agent-shell before installing, or install from a prebuilt plugin bundle.");
}
if (!existsSync(path.join(pluginRoot, "scripts", "burrete-agent.mjs"))) {
  throw new Error("Missing bundled scripts/burrete-agent.mjs. Run bun run build:agent-shell before installing.");
}
if (!existsSync(path.join(pluginRoot, "mcp", "lib", "server-bundle.mjs"))) {
  throw new Error("Missing bundled MCP server. Run bun run build:agent-shell before installing.");
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
