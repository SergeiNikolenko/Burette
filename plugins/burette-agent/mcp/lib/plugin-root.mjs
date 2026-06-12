import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const libDir = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(libDir, "..", "..");
const defaultRepoRoot = path.resolve(pluginRoot, "..", "..");
export const repoRoot = resolveRepoRoot();

export function pluginPath(...parts) {
  return path.join(pluginRoot, ...parts);
}

export function repoPath(...parts) {
  return path.join(repoRoot, ...parts);
}

function resolveRepoRoot() {
  if (process.env.BURRETE_AGENT_REPO_ROOT) {
    return path.resolve(process.env.BURRETE_AGENT_REPO_ROOT);
  }
  try {
    const metadata = JSON.parse(readFileSync(path.join(pluginRoot, ".burette-agent-install.json"), "utf8"));
    if (typeof metadata.repoRoot === "string" && metadata.repoRoot.trim()) {
      return path.resolve(metadata.repoRoot);
    }
  } catch {
    // Source checkouts do not have install metadata.
  }
  return defaultRepoRoot;
}
