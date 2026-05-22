#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildSidebarProjects, filterSidebarProjects } from "../apps/desktop/src/lib/sidebar-projects.ts";

const documents = [
  {
    id: "doc-1",
    path: "/Users/test/Matcha/ligands/mini.pdb",
    title: "mini.pdb",
    extension: "pdb",
    renderer: "molstar",
    runtimePath: "/tmp/runtime-1",
    byteCount: 128,
  },
];

const recentStructures = [
  {
    path: "/Users/test/Matcha/ligands/mini.pdb",
    title: "mini.pdb",
    extension: "pdb",
    renderer: "molstar",
    byteCount: 128,
    openedAt: 10,
  },
  {
    path: "/Users/test/Matcha/archive/alt-mini.pdb",
    title: "alt-mini.pdb",
    extension: "pdb",
    renderer: "molstar",
    byteCount: 64,
    openedAt: 8,
  },
  {
    path: "/Users/test/Burette/mini.sdf",
    title: "mini.sdf",
    extension: "sdf",
    renderer: "grid",
    byteCount: 32,
    openedAt: 6,
  },
];

const projects = buildSidebarProjects({
  documents,
  recentStructures,
  projectRoots: ["/Users/test/Matcha", "/Users/test/Burette"],
  activeDocumentId: "doc-1",
});

assert.equal(projects.length, 2);
assert.equal(projects[0].title, "Matcha");
assert.equal(projects[0].isActive, true);
assert.equal(projects[0].items.length, 2);
assert.deepEqual(
  projects[0].items.map((item) => ({ path: item.path, relativePath: item.relativePath, source: item.source })),
  [
    {
      path: "/Users/test/Matcha/ligands/mini.pdb",
      relativePath: "ligands/mini.pdb",
      source: "open",
    },
    {
      path: "/Users/test/Matcha/archive/alt-mini.pdb",
      relativePath: "archive/alt-mini.pdb",
      source: "recent",
    },
  ],
);
assert.equal(projects[1].title, "Burette");
assert.equal(projects[1].items[0].relativePath, "mini.sdf");

const filtered = filterSidebarProjects(projects, "archive");
assert.equal(filtered.length, 1);
assert.equal(filtered[0].title, "Matcha");
assert.deepEqual(filtered[0].items.map((item) => item.relativePath), ["archive/alt-mini.pdb"]);
