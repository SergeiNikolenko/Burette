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
    path: "/Users/test/Matcha/zrecent.pdb",
    title: "zrecent.pdb",
    extension: "pdb",
    renderer: "molstar",
    byteCount: 96,
    openedAt: 12,
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
  projectRoots: ["/Users/test/Matcha", "/Users/test/Burette", "/Users/test/Empty"],
  activeDocumentId: "doc-1",
  pinnedStructurePaths: ["/Users/test/Matcha/archive/alt-mini.pdb"],
});

assert.equal(projects.length, 3);
const buretteProject = projects.find((project) => project.title === "Burette");
const emptyProject = projects.find((project) => project.title === "Empty");
const matchaProject = projects.find((project) => project.title === "Matcha");
assert.ok(buretteProject);
assert.ok(emptyProject);
assert.ok(matchaProject);
assert.equal(buretteProject.items[0].relativePath, "mini.sdf");
assert.equal(emptyProject.items.length, 0);
assert.equal(matchaProject.isActive, true);
assert.equal(matchaProject.items.length, 3);
assert.deepEqual(
  matchaProject.items.map((item) => ({ path: item.path, relativePath: item.relativePath, source: item.source, isPinned: item.isPinned })),
  [
    {
      path: "/Users/test/Matcha/archive/alt-mini.pdb",
      relativePath: "archive/alt-mini.pdb",
      source: "recent",
      isPinned: true,
    },
    {
      path: "/Users/test/Matcha/ligands/mini.pdb",
      relativePath: "ligands/mini.pdb",
      source: "open",
      isPinned: false,
    },
    {
      path: "/Users/test/Matcha/zrecent.pdb",
      relativePath: "zrecent.pdb",
      source: "recent",
      isPinned: false,
    },
  ],
);

const filtered = filterSidebarProjects(projects, "archive");
assert.equal(filtered.length, 1);
assert.equal(filtered[0].title, "Matcha");
assert.deepEqual(filtered[0].items.map((item) => item.relativePath), ["archive/alt-mini.pdb"]);
