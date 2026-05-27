#!/usr/bin/env node
import assert from "node:assert/strict";

const { dockingRequestForDrop, extensionForDocking, isProteinLikeDockingSource, ligandDropPathsForTarget } =
  await import("../apps/desktop/src/lib/docking-documents.ts");

assert.equal(extensionForDocking("/tmp/protein.mae.gz"), "maegz");
assert.equal(extensionForDocking("/tmp/ligands.sdf"), "sdf");
assert.equal(isProteinLikeDockingSource("/tmp/receptor.pdb"), true);
assert.equal(isProteinLikeDockingSource("/tmp/poses.sdf"), false);

assert.deepEqual(
  ligandDropPathsForTarget("/tmp/receptor.pdb", ["/tmp/poses.sdf", "/tmp/poses.sdf", "/tmp/receptor.pdb", "", "  "]),
  ["/tmp/poses.sdf"],
);

assert.deepEqual(
  dockingRequestForDrop("/tmp/receptor.pdb", ["/tmp/poses.sdf"]),
  {
    receptorPath: "/tmp/receptor.pdb",
    ligandPaths: ["/tmp/poses.sdf"],
  },
);

assert.deepEqual(
  dockingRequestForDrop("/tmp/poses.sdf", ["/tmp/receptor.cif", "/tmp/extra.sdf"]),
  {
    receptorPath: "/tmp/receptor.cif",
    ligandPaths: ["/tmp/poses.sdf", "/tmp/extra.sdf"],
  },
);

assert.deepEqual(
  dockingRequestForDrop("/tmp/receptor.pdb", ["/tmp/pose-a.sdf", "/tmp/pose-a.sdf", "", "  ", "/tmp/pose-b.sdf"]),
  {
    receptorPath: "/tmp/receptor.pdb",
    ligandPaths: ["/tmp/pose-a.sdf", "/tmp/pose-b.sdf"],
  },
);

assert.deepEqual(
  dockingRequestForDrop(
    "burrete-docking://active-view",
    ["/tmp/new-pose.sdf", "/tmp/receptor.pdb", "/tmp/old-pose.sdf", "/tmp/new-pose.sdf"],
    {
      receptorPath: "/tmp/receptor.pdb",
      ligandPaths: ["/tmp/old-pose.sdf"],
    },
  ),
  {
    receptorPath: "/tmp/receptor.pdb",
    ligandPaths: ["/tmp/old-pose.sdf", "/tmp/new-pose.sdf"],
  },
);

console.log("docking document tests passed");
