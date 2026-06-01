#!/usr/bin/env node
import assert from "node:assert/strict";

const { dockingRequestForDrop, extensionForDocking, isProteinLikeDockingSource, ligandDropPathsForTarget } =
  await import("../apps/desktop/src/lib/docking-documents.ts");

assert.equal(extensionForDocking("/tmp/protein.mae.gz"), "maegz");
assert.equal(extensionForDocking("/tmp/protein.MAE.GZ"), "maegz");
assert.equal(extensionForDocking("/tmp/ligands.sdf"), "sdf");
assert.equal(isProteinLikeDockingSource("/tmp/receptor.pdb"), true);
assert.equal(isProteinLikeDockingSource("/tmp/receptor.cif"), true);
assert.equal(isProteinLikeDockingSource("/tmp/receptor.cms"), true);
assert.equal(isProteinLikeDockingSource("/tmp/receptor.mae"), true);
assert.equal(isProteinLikeDockingSource("/tmp/receptor.mae.gz"), true);
assert.equal(isProteinLikeDockingSource("/tmp/receptor.maegz"), true);
assert.equal(isProteinLikeDockingSource("/tmp/receptor.pdbqt"), true);
assert.equal(isProteinLikeDockingSource("/tmp/poses.sdf"), false);
assert.equal(isProteinLikeDockingSource("/tmp/field.cube"), false);
assert.equal(isProteinLikeDockingSource("/tmp/field.cub"), false);

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
  dockingRequestForDrop("/tmp/poses.sdf", ["/tmp/receptor.mae.gz", "/tmp/extra.sdf"]),
  {
    receptorPath: "/tmp/receptor.mae.gz",
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

assert.equal(
  dockingRequestForDrop("/tmp/pose-a.sdf", ["/tmp/pose-b.sdf"]),
  null,
);

assert.equal(
  dockingRequestForDrop("/tmp/receptor-a.pdb", ["/tmp/receptor-b.cif"]),
  null,
);

assert.deepEqual(
  dockingRequestForDrop("/tmp/receptor-a.pdb", ["/tmp/receptor-b.cif", "/tmp/pose-a.sdf"]),
  {
    receptorPath: "/tmp/receptor-a.pdb",
    ligandPaths: ["/tmp/pose-a.sdf"],
  },
);

assert.deepEqual(
  dockingRequestForDrop(
    "burrete-docking://active-view",
    ["/tmp/new-pose.sdf", "/tmp/receptor.pdb", "/tmp/alternate-receptor.cif", "/tmp/old-pose.sdf", "/tmp/new-pose.sdf"],
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

assert.equal(
  dockingRequestForDrop(
    "burrete-docking://active-view",
    ["/tmp/alternate-receptor.cif"],
    {
      receptorPath: "/tmp/receptor.pdb",
      ligandPaths: ["/tmp/old-pose.sdf"],
    },
  ),
  null,
);

assert.equal(
  dockingRequestForDrop(
    "burrete-docking://active-view",
    ["/tmp/old-pose.sdf"],
    {
      receptorPath: "/tmp/receptor.pdb",
      ligandPaths: ["/tmp/old-pose.sdf"],
    },
  ),
  null,
);

console.log("docking document tests passed");
