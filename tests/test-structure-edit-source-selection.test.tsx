import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

// Keep the real controller/provider separate from the editor unit fixture's
// mocked context, regardless of Bun's file ordering or parallel test runners.
test("atom picks follow the real source runtime through queue, promotion and in-place acknowledgement", () => {
  const result = spawnSync(
    process.execPath,
    ["test", "./tests/structure-edit-source-selection.fixture.tsx"],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 256 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
}, 25_000);
