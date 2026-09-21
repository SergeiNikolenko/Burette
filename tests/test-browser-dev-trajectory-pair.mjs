#!/usr/bin/env node
import assert from "node:assert/strict";

import { localTrajectoryPairCandidates } from "../apps/desktop/vite/browser-dev/files.ts";

const extension = (path) => path.split(".").pop()?.toLowerCase() ?? "";

assert.deepEqual(
  localTrajectoryPairCandidates(
    "/workspace/samples/mini.pdb",
    [
      "/workspace/samples/mini.pdb",
      "/workspace/samples/mini.cif",
      "/workspace/samples/md/run.xtc",
      "/workspace/samples/md/run.gro",
      "/workspace/samples/readme.md",
    ],
    extension,
  ),
  [
    "/workspace/samples/mini.pdb",
    "/workspace/samples/mini.cif",
  ],
  "a structure must not pair with a trajectory discovered in a nested directory",
);

assert.deepEqual(
  localTrajectoryPairCandidates(
    "/workspace/samples/md/run.xtc",
    [
      "/workspace/samples/md/run.gro",
      "/workspace/samples/md/run.xtc",
      "/workspace/samples/other/unrelated.pdb",
    ],
    extension,
  ),
  [
    "/workspace/samples/md/run.xtc",
    "/workspace/samples/md/run.gro",
  ],
  "a topology and trajectory in the same directory remain eligible",
);

console.log("browser-dev trajectory pair tests passed");
