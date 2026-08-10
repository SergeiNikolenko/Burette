import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ViteDevServer } from "vite";

import { sendJson, sendJsonError } from "./http";

const PLUGIN_NAMES = new Set(["burette", "burrete"]);
const MANIFEST_RELATIVE_PATHS = [".codex-plugin/plugin.json", ".claude-plugin/plugin.json"];

type IntegrationCheck = {
  id: string;
  label: string;
  state: "ok" | "missing";
  detail: string;
};

type AgentInstall = {
  id: string;
  label: string;
  state: string;
  version: string | null;
  path: string | null;
  message: string;
};

export function browserDevAgentIntegrationStatus(repoRoot: string) {
  const pluginRoot = join(repoRoot, "plugins", "burette-agent");
  const checks: IntegrationCheck[] = [];

  const manifest = readJson(join(pluginRoot, ".codex-plugin", "plugin.json"));
  const manifestName = typeof manifest?.name === "string" ? manifest.name : null;
  pushPathCheck(
    checks,
    "manifest",
    "Plugin manifest",
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    manifestName !== null && PLUGIN_NAMES.has(manifestName),
    "Expected .codex-plugin/plugin.json for Burette.",
  );
  const compatibility = readJson(join(pluginRoot, "compatibility.json"));
  pushPathCheck(
    checks,
    "compatibility",
    "Compatibility manifest",
    join(pluginRoot, "compatibility.json"),
    compatibility !== null,
    "Expected compatibility.json with app and control API requirements.",
  );
  for (const [id, label, relativePath] of [
    ["mcp", "MCP server", "mcp/lib/server-bundle.mjs"],
    ["mcp-config", "MCP config", ".mcp.json"],
    ["skills", "Skills", "skills/index/SKILL.md"],
    ["preflight", "Preflight", "scripts/burette_agent_preflight.mjs"],
    ["cli", "Agent CLI", "scripts/burette-agent.mjs"],
    ["browser-preview", "Browser preview", "scripts/agent-preview.mjs"],
    ["browser-shell", "Browser shell", "browser-shell-dist/index.html"],
    ["preview-web", "Preview web", "preview-web/index.html"],
  ] as const) {
    const candidate = join(pluginRoot, relativePath);
    pushPathCheck(checks, id, label, candidate, existsSync(candidate), "Required by the Burette plugin.");
  }

  const bundledVersion = typeof manifest?.version === "string" ? manifest.version : null;
  const bundleReady = checks.every((check) => check.state === "ok");
  const agentInstalls = [
    agentInstallStatus("codex", "Codex", join(homedir(), ".codex", "plugins"), null, bundledVersion),
    agentInstallStatus(
      "claude-code",
      "Claude Code",
      join(homedir(), ".claude", "plugins"),
      claudeRegistryInstall(),
      bundledVersion,
    ),
  ];

  let state = "ready";
  if (!bundleReady) state = "broken";
  else if (agentInstalls.some((agent) => agent.state === "current")) state = "ready";
  else if (agentInstalls.some((agent) => agent.state === "update_available")) state = "update_available";
  else if (agentInstalls.some((agent) => agent.state === "not_installed")) state = "install_available";

  return {
    schema: "burette_agent_integration.v2",
    state,
    appVersion: "browser-dev",
    bundledPlugin: {
      state: bundleReady ? "ready" : "broken",
      name: "burette",
      version: bundledVersion,
      path: pluginRoot,
      displayName: typeof manifest?.interface?.displayName === "string" ? manifest.interface.displayName : null,
      compatibility: compatibility
        ? {
            app: textField(compatibility?.requires?.buretteApp),
            agentCli: textField(compatibility?.requires?.agentCli),
            controlApi: textField(compatibility?.requires?.controlApi),
          }
        : null,
    },
    agentInstalls,
    checks,
  };
}

export function registerBrowserDevAgentIntegrationRoute(server: ViteDevServer, options: { repoRoot: string }) {
  server.middlewares.use("/__burette/agent-integration", (req, res) => {
    if ((req.method || "GET").toUpperCase() !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" }, "no-cache");
      return;
    }
    try {
      sendJson(res, 200, browserDevAgentIntegrationStatus(options.repoRoot), "no-cache");
    } catch (error) {
      sendJsonError(res, 500, error, "no-cache");
    }
  });
}

function agentInstallStatus(
  id: string,
  label: string,
  pluginsRoot: string,
  registryInstall: { path: string; version: string | null } | null,
  bundledVersion: string | null,
): AgentInstall {
  if (!existsSync(pluginsRoot) && !registryInstall) {
    return {
      id,
      label,
      state: "not_installed",
      version: null,
      path: null,
      message: `No ${label} plugin directory was found for this user.`,
    };
  }
  const found = registryInstall ?? findPluginManifest(pluginsRoot);
  if (!found) {
    return {
      id,
      label,
      state: "not_installed",
      version: null,
      path: null,
      message: `Burette is not installed in the local ${label} plugins.`,
    };
  }
  const version = found.version;
  const state =
    bundledVersion && version ? (bundledVersion === version ? "current" : "update_available") : "unknown";
  const message =
    state === "current"
      ? `${label} has the same plugin version as this Burette bundle.`
      : state === "update_available"
        ? `${label} has a different Burette plugin version.`
        : `${label} has a Burette plugin, but the version could not be compared.`;
  return { id, label, state, version, path: found.path, message };
}

function claudeRegistryInstall(): { path: string; version: string | null } | null {
  const registry = readJson(join(homedir(), ".claude", "plugins", "installed_plugins.json"));
  const plugins = registry?.plugins;
  if (!plugins || typeof plugins !== "object") return null;
  for (const [key, installs] of Object.entries(plugins as Record<string, unknown>)) {
    if (!PLUGIN_NAMES.has(key.split("@")[0] ?? "")) continue;
    const install = Array.isArray(installs) ? installs[0] : null;
    const installPath = textField(install?.installPath);
    if (!installPath) continue;
    const manifest =
      readJson(join(installPath, ".claude-plugin", "plugin.json")) ??
      readJson(join(installPath, ".codex-plugin", "plugin.json"));
    const version = textField(manifest?.version) ?? normalizeVersion(textField(install?.version));
    return { path: installPath, version };
  }
  return null;
}

function findPluginManifest(root: string): { path: string; version: string | null } | null {
  const queue = [root];
  let visited = 0;
  while (queue.length > 0) {
    const directory = queue.shift()!;
    visited += 1;
    if (visited > 2_000) return null;
    for (const manifestRelative of MANIFEST_RELATIVE_PATHS) {
      const manifest = readJson(join(directory, manifestRelative));
      const name = textField(manifest?.name);
      if (name && PLUGIN_NAMES.has(name)) {
        return { path: directory, version: normalizeVersion(textField(manifest?.version)) };
      }
    }
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push(join(directory, entry.name));
    }
  }
  return null;
}

function pushPathCheck(
  checks: IntegrationCheck[],
  id: string,
  label: string,
  path: string,
  ok: boolean,
  missingDetail: string,
) {
  checks.push({ id, label, state: ok ? "ok" : "missing", detail: ok ? path : missingDetail });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeVersion(value: string | null): string | null {
  return value && value !== "unknown" ? value : null;
}
