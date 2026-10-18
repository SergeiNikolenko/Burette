import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveModelPython(repoRoot) {
  const configured = process.env.BURETTE_CHEMICAL_SPACE_MODEL_PYTHON?.trim();
  if (configured && existsSync(configured)) return { path: configured, source: "override" };
  const root = process.env.BURETTE_CHEMICAL_SPACE_MODEL_RUNTIME_DIR?.trim()
    || join(homedir(), "Library", "Application Support", "Burette", "model-python");
  try {
    const stamp = JSON.parse(readFileSync(join(root, "burette-install.json"), "utf8"));
    const requirements = readFileSync(join(repoRoot, "compute/models/requirements.txt"), "utf8");
    const bootstrap = readFileSync(join(repoRoot, "compute/models/requirements-bootstrap.txt"), "utf8");
    const python = join(root, "bin/python3");
    if (stamp.requirements === requirements && stamp.bootstrapRequirements === bootstrap && existsSync(python)) {
      return { path: python, source: "managed" };
    }
  } catch {
    // An old, missing or malformed stamp requires a staged reinstall.
  }
  const dev = join(repoRoot, ".venv-chemical-space/bin/python");
  return existsSync(dev) ? { path: dev, source: "dev" } : null;
}
