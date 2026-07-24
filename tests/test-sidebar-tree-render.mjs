#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileKindForPath } from "../apps/desktop/src/components/sidebar/file-kind-icon.tsx";
import { ProjectGroup } from "../apps/desktop/src/components/sidebar/file-tree-node.tsx";

const project = {
  id: "project:/fixtures/BurettePreviewSamples",
  rootPath: "/fixtures/BurettePreviewSamples",
  title: "BurettePreviewSamples",
  subtitle: "/fixtures",
  isExplicit: true,
  isPinned: false,
  isActive: false,
  matchText: "burettepreviewsamples",
  items: [
    structure("/fixtures/BurettePreviewSamples/mini.pdb", "mini.pdb", "mini.pdb"),
    structure("/fixtures/BurettePreviewSamples/md/minimal.xtc", "minimal.xtc", "md/minimal.xtc"),
    structure("/fixtures/BurettePreviewSamples/sdf/multi.sdf", "multi.sdf", "sdf/multi.sdf"),
    structure("/fixtures/BurettePreviewSamples/xyz/trajectory.xyz", "trajectory.xyz", "xyz/trajectory.xyz"),
  ],
};

const state = {
  sidebarQuery: "",
  expandedProjectIds: [project.id],
  documents: [],
  projectNameOverrides: {
    "/fixtures/BurettePreviewSamples/md": "Dynamics",
  },
};

const actions = new Proxy({}, { get: () => () => {} });
const html = renderToStaticMarkup(React.createElement(ProjectGroup, { project, state, actions }));

for (const expected of [
  "project-folder-row",
  "project-folder-children",
  "aria-expanded=\"true\"",
  "aria-expanded=\"false\"",
  "data-expanded=\"false\"",
  "Dynamics",
  "sdf",
  "xyz",
  "minimal.xtc",
  "multi.sdf",
  "trajectory.xyz",
]) {
  assert.match(html, new RegExp(escapeRegExp(expected)));
}

const crowdedFolderProject = {
  ...project,
  id: "project:/fixtures/crowded",
  rootPath: "/fixtures/crowded",
  title: "crowded",
  items: Array.from({ length: 7 }, (_, index) => {
    const title = `pose-${index + 1}.sdf`;
    return structure(`/fixtures/crowded/results/${title}`, title, `results/${title}`);
  }),
};
const crowdedState = {
  ...state,
  expandedProjectIds: [crowdedFolderProject.id],
};
const crowdedHtml = renderToStaticMarkup(React.createElement(ProjectGroup, {
  project: crowdedFolderProject,
  state: crowdedState,
  actions,
}));

assert.match(crowdedHtml, /results/);
assert.match(crowdedHtml, /Show more/);
assert.match(crowdedHtml, /Show 2 more files in results/);
assert.match(crowdedHtml, /pose-5\.sdf/);
assert.doesNotMatch(crowdedHtml, /pose-6\.sdf/);

// A file row is identified by the scientific role of its contents, not by one
// shared document glyph, so the fixture's four files must land on three kinds.
for (const kind of ["protein", "trajectory", "molecule"]) {
  assert.match(html, new RegExp(`data-file-kind="${kind}"`));
}
assert.doesNotMatch(html, /data-file-kind="default"/);

// Anything that can reach a sidebar row must resolve to a real kind, or it
// silently falls back to the blank page glyph. The registry is not the only
// source: browser dev scans its own list, which is how .dtr slipped through.
const previewRegistry = JSON.parse(readFileSync(new URL("../config/preview-formats.json", import.meta.url), "utf8"));
const sidebarProjectsHook = readFileSync(new URL("../apps/desktop/src/hooks/use-app-sidebar-projects.ts", import.meta.url), "utf8");
const browserDevExtensions = sidebarProjectsHook
  .split("browserDevStructureExtensions = new Set([")[1]
  ?.split("]);")[0];
assert.ok(browserDevExtensions, "browserDevStructureExtensions is no longer a literal Set this test can read");

const scannedExtensions = [
  ...previewRegistry.formats.flatMap((format) => format.extensions),
  ...[...browserDevExtensions.matchAll(/"([a-z0-9.]+)"/gu)].map((match) => match[1]),
];
const unmapped = [...new Set(scannedExtensions)]
  .filter((extension) => fileKindForPath(`/fixtures/sample.${extension}`) === "default");
assert.deepEqual(unmapped, [], `scanned extensions with no sidebar icon kind: ${unmapped.join(", ")}`);

// The extension wins over a path that has none, and an unknown one still renders.
assert.equal(fileKindForPath("/fixtures/receptor", "pdb"), "protein");
assert.equal(fileKindForPath("/fixtures/topology.PRMTOP"), "topology");
assert.equal(fileKindForPath("/fixtures/notes.unknownext"), "default");

// Extensions are user-supplied, so a lookup that walks Object.prototype would
// return a function or an object here instead of a kind.
for (const inherited of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
  assert.equal(fileKindForPath(`/fixtures/notes.${inherited}`), "default");
}

console.log("sidebar tree render tests passed");

function structure(path, title, relativePath) {
  return {
    key: `project:${path}`,
    path,
    title,
    relativePath,
    extension: title.split(".").at(-1) ?? "",
    renderer: "molstar",
    byteCount: 128,
    openedAt: null,
    source: "project",
    documentId: null,
    isActive: false,
    isOpen: false,
    isPinned: false,
    matchText: relativePath,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
