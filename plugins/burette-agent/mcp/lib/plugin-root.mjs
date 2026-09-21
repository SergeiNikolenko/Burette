import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const libDir = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(libDir, "..", "..");
const defaultRepoRoot = path.resolve(pluginRoot, "..", "..");
const repoRootResolution = resolveRepoRoot();
export const repoRoot = repoRootResolution.path;
export const repoRootSource = repoRootResolution.source;
export const repoRootMetadataPath = path.join(pluginRoot, ".burette-agent-install.json");

export function pluginPath(...parts) {
  return path.join(pluginRoot, ...parts);
}

export function repoPath(...parts) {
  return path.join(repoRoot, ...parts);
}

function resolveRepoRoot() {
  if (process.env.BURETTE_AGENT_REPO_ROOT) {
    return { path: path.resolve(process.env.BURETTE_AGENT_REPO_ROOT), source: "env" };
  }
  try {
    const metadata = JSON.parse(readFileSync(path.join(pluginRoot, ".burette-agent-install.json"), "utf8"));
    if (typeof metadata.repoRoot === "string" && metadata.repoRoot.trim()) {
      return { path: path.resolve(metadata.repoRoot), source: "metadata" };
    }
  } catch {
    // Source checkouts do not have install metadata.
  }
  const sourceCheckoutCli = path.join(defaultRepoRoot, "scripts", "burette-agent.mjs");
  if (existsSync(sourceCheckoutCli)) {
    return { path: defaultRepoRoot, source: "source-checkout" };
  }
  return { path: defaultRepoRoot, source: "fallback-unverified" };
}
