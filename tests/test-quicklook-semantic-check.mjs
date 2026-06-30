#!/usr/bin/env bun
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "quicklook-semantic-check.mjs");
const workspace = await mkdtemp(path.join(tmpdir(), "burrete-semantic-check-"));

async function runCase(name, filePath, lines) {
  const logPath = path.join(workspace, `${name}.log`);
  await writeFile(logPath, `${lines.join("\n")}\n`, "utf8");
  const result = spawnSync("bun", [script, logPath, filePath], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

const xyzrenderFile = path.join(root, "samples", "quantum", "inputs", "caffeine.com");
const sdfFile = path.join(root, "samples", "collections", "sdf", "multi.sdf");
const csvTableFile = path.join(root, "samples", "collections", "tables", "no-molecule-column.csv");

const xyzrenderSuccess = await runCase("xyzrender-success", xyzrenderFile, [
  `[AAAA0001] file.path=${xyzrenderFile}`,
  "[AAAA0001] [build] detected.format=mol binary=false renderer=xyzrender-external",
  "[AAAA0001] preview.evidence type=ready renderer=xyzrender-external externalArtifact=true xyzrenderSvgBytes=7209",
]);
assert.equal(xyzrenderSuccess.status, 0);
assert.match(xyzrenderSuccess.stdout, /xyzrender svgBytes=7209/);

const xyzrenderFakeReady = await runCase("xyzrender-fake-ready", xyzrenderFile, [
  `[BBBB0001] file.path=${xyzrenderFile}`,
  "[BBBB0001] [build] detected.format=mol binary=false renderer=xyzrender-external",
  "[BBBB0001] preview.evidence type=ready renderer=xyzrender-external externalArtifact=false xyzrenderSvgBytes=0",
]);
assert.equal(xyzrenderFakeReady.status, 1);
assert.match(xyzrenderFakeReady.stderr, /did not produce an external xyzrender SVG artifact/);

const xyzrenderNativeError = await runCase("xyzrender-native-error", xyzrenderFile, [
  `[CCCC0001] file.path=${xyzrenderFile}`,
  "[CCCC0001] native build error: PreviewExternalXyzrenderError: External xyzrender process could not be launched.",
  "[CCCC0001] renderNativeError for caffeine.com: External xyzrender process could not be launched.",
]);
assert.equal(xyzrenderNativeError.status, 1);
assert.match(xyzrenderNativeError.stderr, /contains an error or timeout/);

const xyzrenderTextFallback = await runCase("xyzrender-text-fallback", xyzrenderFile, [
  `[CCCC0002] file.path=${xyzrenderFile}`,
  "[CCCC0002] [build] detected.previewMode=text-fallback",
  "[CCCC0002] preview.evidence type=ready mode=text renderer=text-fallback sourceExtension=com",
]);
assert.equal(xyzrenderTextFallback.status, 0);
assert.match(xyzrenderTextFallback.stdout, /text fallback ready/);

const gridSuccess = await runCase("grid-success", sdfFile, [
  `[DDDD0001] file.path=${sdfFile}`,
  "[DDDD0001] [build] detected.previewMode=grid2d rows=2 moleculeRows=2",
  "[DDDD0001] preview.evidence type=ready mode=grid2d renderer=rdkit rowCount=2 moleculeRowCount=2 renderedCount=2 rdkitLoaded=true rdkitImages=2",
]);
assert.equal(gridSuccess.status, 0);
assert.match(gridSuccess.stdout, /grid rows=2 moleculeRows=2 rdkitImages=2/);

const gridNoImages = await runCase("grid-no-images", sdfFile, [
  `[EEEE0001] file.path=${sdfFile}`,
  "[EEEE0001] [build] detected.previewMode=grid2d rows=2 moleculeRows=2",
  "[EEEE0001] preview.evidence type=ready mode=grid2d renderer=rdkit rowCount=2 moleculeRowCount=2 renderedCount=2 rdkitLoaded=true rdkitImages=0",
]);
assert.equal(gridNoImages.status, 1);
assert.match(gridNoImages.stderr, /did not produce RDKit molecule images/);

const tabularGridSuccess = await runCase("tabular-grid-success", csvTableFile, [
  `[FFFF0001] file.path=${csvTableFile}`,
  "[FFFF0001] [build] detected.previewMode=grid2d format=csv records=2/2",
  "[FFFF0001] preview.evidence type=ready mode=grid2d renderer=rdkit rowCount=2 moleculeRowCount=0 renderedCount=2 rdkitLoaded=false rdkitImages=0",
]);
assert.equal(tabularGridSuccess.status, 0);
assert.match(tabularGridSuccess.stdout, /grid rows=2 tableRows=2/);

console.log("quicklook semantic check tests passed");
