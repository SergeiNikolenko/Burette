#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");

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

const pluginManifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const repoPackagePath = path.join(repoRoot, "package.json");
const cliPath = path.join(repoRoot, "scripts", "burrete-agent.mjs");
const previewPath = path.join(repoRoot, "scripts", "agent-preview.mjs");
const desktopApp = process.env.BURRETE_AGENT_APP || null;

const [pluginManifest, repoPackage, hasCli, hasPreview, hasDesktopApp] = await Promise.all([
  readJson(pluginManifestPath, {}),
  readJson(repoPackagePath, {}),
  exists(cliPath),
  exists(previewPath),
  desktopApp ? exists(desktopApp) : Promise.resolve(false),
]);

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
    preferredDesktopApp: {
      path: desktopApp,
      status: desktopApp ? (hasDesktopApp ? "available" : "missing") : "not_configured",
    },
  },
  context: {
    scope: "burette_agent_capability_registry",
    preferredMode: desktopApp ? "desktop-app" : "browser-preview",
    transports: [
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
      openWorkspace: ["open local PDB/CIF/XYZ/SDF-like artifacts", "choose browser-preview or desktop-app"],
      molstarScene: ["observe scene", "focus ligand", "hide waters", "surface", "color", "reset camera"],
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
      reset_camera: "supported",
      focus_ligand: "supported_when_detectable",
      hide_waters: "supported",
      show_waters: "supported",
      show_surface: "best_effort",
      color_by_chain: "best_effort",
      contacts: "supported_when_structure_available",
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
