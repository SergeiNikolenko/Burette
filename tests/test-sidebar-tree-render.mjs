#!/usr/bin/env node
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
};

const actions = new Proxy({}, { get: () => () => {} });
const html = renderToStaticMarkup(React.createElement(ProjectGroup, { project, state, actions }));

for (const expected of [
  "project-folder-row",
  "project-folder-children",
  "aria-expanded=\"true\"",
  "md",
  "sdf",
  "xyz",
  "minimal.xtc",
  "multi.sdf",
  "trajectory.xyz",
]) {
  assert.match(html, new RegExp(escapeRegExp(expected)));
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
