#!/usr/bin/env bun
import assert from "node:assert/strict";
import {
  fileBackedViewerDocumentPath,
  isAbsoluteNativeFilePath,
  nativeOpenDocumentPaths,
} from "../apps/desktop/src/lib/native-menu-paths.ts";

assert.equal(isAbsoluteNativeFilePath("/tmp/molecules.sdf"), true);
assert.equal(isAbsoluteNativeFilePath("C:\\molecules.sdf"), true);
assert.equal(isAbsoluteNativeFilePath("relative/molecules.sdf"), false);

const combinedDocument = {
  path: "/tmp/workspace#combined-sdf-grid",
  virtual: true,
};
assert.equal(fileBackedViewerDocumentPath(combinedDocument), null);
assert.equal(
  fileBackedViewerDocumentPath({ path: "/tmp/molecules.sdf", virtual: false }),
  "/tmp/molecules.sdf",
);

assert.deepEqual(nativeOpenDocumentPaths([
  combinedDocument,
  { path: "/tmp/molecules.sdf" },
  { path: "/tmp/molecules.sdf" },
  { path: "virtual:report", virtual: true },
], [
  { path: "/tmp/notes.txt" },
  { path: "relative.txt" },
]), [
  "/tmp/molecules.sdf",
  "/tmp/notes.txt",
]);
