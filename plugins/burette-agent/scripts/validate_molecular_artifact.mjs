#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { validateMolecularArtifact } from "../mcp/lib/validation.mjs";

function usage() {
  console.error("Usage: node scripts/validate_molecular_artifact.mjs <manifest.json> <snapshot.json> [surface]");
}

const [manifestPath, snapshotPath, surface = "molecular-report"] = process.argv.slice(2);
if (!manifestPath || !snapshotPath) {
  usage();
  process.exit(2);
}

try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const result = validateMolecularArtifact({ manifest, snapshot, surface });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: "VALIDATION_INPUT_ERROR",
      message: error?.message || String(error),
    },
  }, null, 2));
  process.exit(1);
}
