import { spawnSync } from "node:child_process";

// Each UI fixture owns its globals and mock modules.
for (const file of [
  "tests/test-geometry-kinetic.test.tsx",
  "tests/test-geometry-optimization-result.test.tsx",
  "tests/test-workbench-zmatrix.test.tsx",
  "tests/test-workbench-zmatrix-source-session.test.tsx",
  "tests/test-workbench-zmatrix-definition.test.tsx",
  "tests/test-workbench-zmatrix-optimize.test.tsx",
  "tests/test-workbench-zmatrix-rows.test.tsx",
  "tests/test-geometry-dock-activation.test.tsx"
]) {
  const result = spawnSync(process.execPath, ["test", file], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
