#!/usr/bin/env bun
import assert from "node:assert/strict";
import {
  fileBackedViewerDocumentPath,
  isAbsoluteNativeFilePath,
  nativeOpenDocumentPaths,
  nativeTabDocumentPaths,
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

// Restored file tabs claim their original paths before any viewer loads.
assert.deepEqual(nativeOpenDocumentPaths([], [], nativeTabDocumentPaths([
  { location: { kind: "file", path: "/tmp/sheet.xyz", recoveryPath: "/tmp/checkpoint.xyz" } },
  { location: { kind: "text-file", path: "/tmp/source.pdb" } },
  { location: { kind: "document", path: "/tmp/report.pdf" } },
  { location: { kind: "file", path: "/tmp/sheet.xyz" } },
  { location: { kind: "file", path: "virtual:report" } },
  { location: { kind: "settings" } },
])), ["/tmp/sheet.xyz", "/tmp/source.pdb", "/tmp/report.pdf"]);
