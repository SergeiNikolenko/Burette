#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const defaultRepoRoot = path.resolve(pluginRoot, "..", "..");
const repoRootResolution = await resolveRepoRoot();
const repoRoot = repoRootResolution.path;

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function resolveRepoRoot() {
  if (process.env.BURRETE_AGENT_REPO_ROOT) {
    return { path: path.resolve(process.env.BURRETE_AGENT_REPO_ROOT), source: "env" };
  }
  const metadata = await readJson(path.join(pluginRoot, ".burette-agent-install.json"), {});
  if (typeof metadata.repoRoot === "string" && metadata.repoRoot.trim()) {
    return { path: path.resolve(metadata.repoRoot), source: "metadata" };
  }
  if (await exists(path.join(defaultRepoRoot, "scripts", "burrete-agent.mjs"))) {
    return { path: defaultRepoRoot, source: "source-checkout" };
  }
  return { path: defaultRepoRoot, source: "fallback-unverified" };
}

const pluginManifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const repoPackagePath = path.join(repoRoot, "package.json");
const cliPath = path.join(repoRoot, "scripts", "burrete-agent.mjs");
const previewPath = path.join(repoRoot, "scripts", "agent-preview.mjs");
const agentShellServerPath = path.join(repoRoot, "scripts", "agent-shell-server.mjs");
const agentShellDistPath = process.env.BURRETE_AGENT_SHELL_DIST_DIR
  ? path.resolve(process.env.BURRETE_AGENT_SHELL_DIST_DIR)
  : path.join(repoRoot, "apps", "desktop", "dist");
const desktopApp = process.env.BURRETE_AGENT_APP || null;
const hasVp = commandExists("vp");

const [pluginManifest, repoPackage, hasCli, hasPreview, hasAgentShellServer, hasAgentShellDist, hasDesktopApp] = await Promise.all([
  readJson(pluginManifestPath, {}),
  readJson(repoPackagePath, {}),
  exists(cliPath),
  exists(previewPath),
  exists(agentShellServerPath),
  exists(path.join(agentShellDistPath, "index.html")),
  desktopApp ? exists(desktopApp) : Promise.resolve(false),
]);
const hasPrebuiltAgentShell = hasAgentShellServer && hasAgentShellDist;
const hasFullBrowserAgentShell = hasCli && (hasPrebuiltAgentShell || hasVp);

function commandExists(command) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status === 0;
}

const payload = {
  schema: "burette_agent_preflight.v1",
  readOnly: true,
  plugin: {
    name: pluginManifest.name || "burrete",
    version: pluginManifest.version || "0.0.0",
    root: pluginRoot,
  },
  repository: {
    root: repoRoot,
    source: repoRootResolution.source,
    packageName: repoPackage.name || null,
    packageVersion: repoPackage.version || null,
  },
  files: {
    cli: {
      path: cliPath,
      status: hasCli ? "available" : "missing",
    },
    browserPreviewServer: {
      path: previewPath,
      status: hasPreview ? "available" : "missing",
    },
    browserAgentShellServer: {
      path: agentShellServerPath,
      status: hasAgentShellServer ? "available" : "missing",
    },
    browserAgentShellDist: {
      path: agentShellDistPath,
      status: hasAgentShellDist ? "available" : "missing",
    },
    preferredDesktopApp: {
      path: desktopApp,
      status: desktopApp ? (hasDesktopApp ? "available" : "missing") : "not_configured",
    },
    vitePlus: {
      command: "vp",
      status: hasVp ? "available" : "missing",
    },
  },
  context: {
    scope: "burette_agent_capability_registry",
    preferredMode: "auto",
    transports: [
      {
        id: "auto",
        status: hasCli && hasPreview ? "available" : "blocked",
        note: "Start the full browser agent shell when available; fall back to browser-preview when the shell cannot start.",
      },
      {
        id: "browser-agent-shell",
        status: hasFullBrowserAgentShell ? "available" : "blocked",
        note: hasPrebuiltAgentShell
          ? "Agent-owned full Browser shell from the prebuilt static bundle with local runtime endpoints."
          : "Agent-owned full Browser shell on a fresh local port with ?devFiles=...; currently requires vp dev until the prebuilt bundle is present.",
      },
      {
        id: "browser-preview",
        status: hasCli && hasPreview ? "available" : "blocked",
        note: "Token-gated localhost preview driven by scripts/agent-preview.mjs.",
      },
      {
        id: "desktop-app",
        status: hasCli ? "available" : "blocked",
        note: "Explicit file-backed session directory passed through --burrete-agent-session.",
      },
    ],
    visualQaSurfaces: [
      {
        id: "Browser",
        status: "available_when_plugin_present",
        role: "Verify localhost/browser-preview visual state and screenshots.",
      },
      {
        id: "Computer",
        status: "available_when_plugin_present",
        role: "Verify real desktop window, accessibility tree, and native/Tauri controls.",
      },
    ],
    workflowRoutes: {
      openWorkspace: ["open local PDB/CIF/XYZ/SDF-like artifacts", "choose auto, browser-agent-shell, browser-preview, or desktop-app"],
      molstarScene: [
        "observe scene",
        "apply MolViewSpec-informed declarative scene schema",
        "focus ligand",
        "highlight/select/focus components",
        "hide waters",
        "surface",
        "color",
        "reset camera",
        "load complete MolViewSpec scenes",
      ],
      moleculeCollection: ["render SDF/property tables", "filter/sort externally", "link row selection to viewer"],
      trajectoryReview: ["load result bundles", "review frame metrics", "show trajectory controls when supported"],
      workflowResults: ["accept server-produced prep/docking/MD artifacts", "surface logs and run reports"],
      molecularReport: ["render notes, tables, charts, and provenance side panels"],
      visualQa: ["Browser smoke", "Computer desktop smoke", "screenshot checks"],
    },
  },
  capabilities: {
    structures: {
      pdb: "supported",
      cif: "supported",
      xyz: "supported",
      sdf: "partial",
    },
    molstarActions: {
      apply_scene: "supported",
      scene_language: "mvs_informed_active_viewer_dsl",
      reset_camera: "supported",
      focus_ligand: "supported_when_detectable",
      hide_waters: "supported",
      show_waters: "supported",
      show_surface: "best_effort",
      color_by_chain: "best_effort",
      contacts: "supported_when_structure_available",
      load_mvs: "supported_for_complete_mvs_payloads",
      full_mvs_scene: "supported_via_load_mvs",
    },
    externalWorkflows: {
      proteinPreparation: "external_workflow",
      ligandPreparation: "external_workflow",
      docking: "external_workflow",
      molecularDynamics: "external_workflow",
      trajectoryCleanup: "external_workflow",
    },
  },
  control: {
    proceed: hasCli && hasPreview,
    blockers: [
      ...(hasCli ? [] : ["scripts/burrete-agent.mjs is missing"]),
      ...(hasPreview ? [] : ["scripts/agent-preview.mjs is missing"]),
    ],
  },
};

console.log(JSON.stringify(payload, null, 2));
