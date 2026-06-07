import path from "node:path";
import { fileURLToPath } from "node:url";

const libDir = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(libDir, "..", "..");
export const repoRoot = path.resolve(pluginRoot, "..", "..");

export function pluginPath(...parts) {
  return path.join(pluginRoot, ...parts);
}

export function repoPath(...parts) {
  return path.join(repoRoot, ...parts);
}
