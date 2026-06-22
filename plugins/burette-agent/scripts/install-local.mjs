#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const marketplacePath = path.join(process.env.HOME, ".agents", "plugins", "marketplace.json");
const pluginSymlinkPath = path.join(process.env.HOME, ".agents", "plugins", "burrete");
const codexConfigPath = path.join(process.env.HOME, ".codex", "config.toml");

const skipBuild = process.argv.includes("--skip-build");

if (!process.env.HOME) {
  throw new Error("HOME is not set.");
}

const marketplaceName = await resolveMarketplaceName();
const pluginId = `burrete@${marketplaceName}`;
const installRoot = path.join(process.env.HOME, ".codex", "plugins", "cache", marketplaceName, "burrete", "0.1.0");

if (!skipBuild && isSourceCheckout()) {
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

await rm(path.join(process.env.HOME, ".codex", "plugins", "cache", marketplaceName, "burrete"), {
  recursive: true,
  force: true,
});
await mkdir(installRoot, { recursive: true });
await run("rsync", ["-a", "--delete", "--exclude", "node_modules", `${pluginRoot}/`, `${installRoot}/`], { cwd: repoRoot });
await writeFile(path.join(installRoot, ".burette-agent-install.json"), `${JSON.stringify({ repoRoot }, null, 2)}\n`);
await run("bun", ["install", "--production"], { cwd: installRoot });

await updateMarketplace();
await updatePluginSymlink();
await updateCodexConfig();

console.log(JSON.stringify({
  ok: true,
  plugin: pluginId,
  marketplaceName,
  installRoot,
  marketplacePath,
  codexConfigPath,
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
  let data = { name: marketplaceName, interface: { displayName: marketplaceDisplayName(marketplaceName) }, plugins: [] };
  if (existsSync(marketplacePath)) {
    data = JSON.parse(await readFile(marketplacePath, "utf8"));
  }
  data.name = marketplaceName;
  data.interface = data.interface || { displayName: marketplaceDisplayName(marketplaceName) };
  data.plugins = (data.plugins || []).filter((plugin) => plugin.name !== "burrete");
  data.plugins.push({
    name: "burrete",
    source: { source: "local", path: "./.agents/plugins/burrete" },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Science",
  });
  await writeFile(marketplacePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function updatePluginSymlink() {
  await mkdir(path.dirname(pluginSymlinkPath), { recursive: true });
  await unlink(pluginSymlinkPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  await symlink(installRoot, pluginSymlinkPath);
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

async function resolveMarketplaceName() {
  const explicit = process.env.BURRETE_PLUGIN_MARKETPLACE?.trim();
  if (explicit) return explicit;
  if (existsSync(marketplacePath)) {
    try {
      const data = JSON.parse(await readFile(marketplacePath, "utf8"));
      if (typeof data.name === "string" && data.name.trim()) return data.name.trim();
    } catch {
      // Fall through to the portable default.
    }
  }
  return "burrete";
}

function marketplaceDisplayName(name) {
  return name === "burrete" ? "Burrete" : name;
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
