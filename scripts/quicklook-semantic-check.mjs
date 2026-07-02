#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [logPath, previewFile] = process.argv.slice(2);

if (!logPath || !previewFile) {
  console.error("usage: scripts/quicklook-semantic-check.mjs /path/to/log-snapshot /path/to/preview-file");
  process.exit(64);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(await readFile(path.join(root, "config", "preview-formats.json"), "utf8"));
const logText = await readFile(logPath, "utf8");

function extensionFor(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (name.endsWith(".mae.gz")) return "mae.gz";
  return path.extname(name).slice(1);
}

function formatForExtension(extension) {
  return registry.formats.find((format) => format.extensions?.includes(extension));
}

function blockForFile(text, filePath) {
  const lines = text.split(/\r?\n/u);
  const token = `file.path=${filePath}`;
  const start = lines.findLastIndex((line) => line.includes(token));
  if (start < 0) return null;
  const next = lines.findIndex((line, index) => index > start && line.includes("file.path="));
  return lines.slice(start, next < 0 ? lines.length : next);
}

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  return value;
}

function parseEvidence(lines) {
  return lines.flatMap((line) => {
    const marker = "preview.evidence ";
    const index = line.indexOf(marker);
    if (index < 0) return [];
    const record = {};
    for (const token of line.slice(index + marker.length).match(/\S+/gu) ?? []) {
      const separator = token.indexOf("=");
      if (separator <= 0) continue;
      record[token.slice(0, separator)] = parseValue(token.slice(separator + 1));
    }
    return [record];
  });
}

function lineWith(lines, token) {
  return lines.find((line) => line.includes(token));
}

function numberFromLine(line, key) {
  const match = line?.match(new RegExp(`\\b${key}=(-?\\d+(?:\\.\\d+)?)`, "u"));
  return match ? Number(match[1]) : 0;
}

function maxEvidenceNumber(evidence, key) {
  return evidence.reduce((max, record) => {
    const value = Number(record[key] ?? 0);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
}

function hasEvidence(evidence, predicate) {
  return evidence.find((record) => {
    try {
      return predicate(record);
    } catch {
      return false;
    }
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function skip(message) {
  console.log(message);
  process.exit(2);
}

function pass(message) {
  console.log(message);
  process.exit(0);
}

const extension = extensionFor(previewFile);
const format = formatForExtension(extension);
if (!format) {
  skip(`unsupported extension .${extension}`);
}

const lines = blockForFile(logText, previewFile);
if (!lines) {
  fail(`no Quick Look log block for ${previewFile}`);
}

const blockText = lines.join("\n");
if (/native build error|JS message type=error|render timeout/u.test(blockText)) {
  fail("preview log contains an error or timeout");
}

const evidence = parseEvidence(lines);
const readyEvidence = evidence.filter((record) => record.type === "ready" || record.mode || record.renderer);
const strategy = format.preview?.strategy ?? "direct";
const renderer = format.preview?.renderer ?? format.viewer?.molstarFormat ?? "";
const selectedXyzrender =
  renderer === "xyzrender-external" ||
  Boolean(lineWith(lines, "renderer=xyzrender-external")) ||
  Boolean(hasEvidence(readyEvidence, (record) => record.renderer === "xyzrender-external"));

if (selectedXyzrender) {
  const semanticReady = hasEvidence(readyEvidence, (record) =>
    record.renderer === "xyzrender-external" &&
    record.externalArtifact === true &&
    Number(record.xyzrenderSvgBytes || 0) > 0
  );
  if (!semanticReady) fail("xyzrender preview did not produce an external xyzrender SVG artifact");
  pass(`xyzrender svgBytes=${maxEvidenceNumber(readyEvidence, "xyzrenderSvgBytes")}`);
}

if (renderer === "spectrum") {
  const detected = lineWith(lines, "detected.previewMode=spectrum");
  const peakCount = numberFromLine(detected, "peaks");
  if (!detected || peakCount <= 0) fail("spectrum preview did not report drawable peaks");
  if (lineWith(lines, "[build] detected.format=")) fail("spectrum preview fell through to the structure renderer");
  const semanticReady = hasEvidence(readyEvidence, (record) =>
    record.mode === "spectrum" && record.renderer === "spectrum" && Number(record.peakCount || 0) > 0
  );
  if (!semanticReady) fail("spectrum preview reached ready without spectrum evidence");
  pass(`spectrum peaks=${peakCount}`);
}

if (renderer === "fep-graphml") {
  const detected = lineWith(lines, "detected.previewMode=fep-graphml");
  if (!detected) fail("FEP GraphML preview did not use the FEP renderer");
  const edgeCount = Math.max(numberFromLine(detected, "edges"), maxEvidenceNumber(readyEvidence, "edgeCount"));
  const moleculesWithAtoms = Math.max(
    numberFromLine(detected, "moleculesWithAtoms"),
    maxEvidenceNumber(readyEvidence, "moleculesWithAtoms"),
  );
  const atomCount = Math.max(numberFromLine(detected, "atoms"), maxEvidenceNumber(readyEvidence, "atomCount"));
  if (edgeCount <= 0) {
    fail("FEP network preview did not report graph edges");
  }
  if (format.id === "graphml" && (moleculesWithAtoms <= 0 || atomCount <= 0)) {
    fail("FEP GraphML preview did not report graph edges and molecule atoms");
  }
  pass(`fep edges=${edgeCount} moleculesWithAtoms=${moleculesWithAtoms} atoms=${atomCount}`);
}

if (strategy === "grid" || lineWith(lines, "detected.previewMode=grid2d")) {
  if (!lineWith(lines, "detected.previewMode=grid2d")) fail("grid preview did not use the 2D grid renderer");
  const rowCount = maxEvidenceNumber(readyEvidence, "rowCount");
  const moleculeRowCount = maxEvidenceNumber(readyEvidence, "moleculeRowCount");
  const renderedCount = maxEvidenceNumber(readyEvidence, "renderedCount");
  if (rowCount <= 0) fail("grid preview reached ready with no rows");
  if (moleculeRowCount > 0) {
    const rdkitReady = hasEvidence(readyEvidence, (record) =>
      record.mode === "grid2d" &&
      record.renderer === "rdkit" &&
      record.rdkitLoaded === true &&
      Number(record.rdkitImages || 0) > 0
    );
    if (!rdkitReady) fail("molecular grid preview did not produce RDKit molecule images");
    pass(`grid rows=${rowCount} moleculeRows=${moleculeRowCount} rdkitImages=${maxEvidenceNumber(readyEvidence, "rdkitImages")}`);
  }
  if (renderedCount <= 0) fail("non-molecular grid preview did not render table rows");
  pass(`grid rows=${rowCount} tableRows=${renderedCount}`);
}

if (strategy === "trajectory") {
  if (!lineWith(lines, "[build] detected.format=")) fail("trajectory preview did not report a structure format");
  const frameCount = Math.max(
    numberFromLine(lineWith(lines, "trajectory.frames="), "trajectory.frames"),
    numberFromLine(lineWith(lines, "trajectory.detected.frames="), "trajectory.detected.frames"),
    maxEvidenceNumber(readyEvidence, "trajectoryFrameCount"),
    maxEvidenceNumber(readyEvidence, "poseCount"),
  );
  if (frameCount <= 1) fail("trajectory preview reached ready without multi-frame evidence");
  pass(`trajectory frames=${frameCount}`);
}

if (strategy === "text") {
  if (!lineWith(lines, "detected.previewMode=text-artifact")) fail("text artifact preview did not use the text renderer");
  if (!readyEvidence.length) fail("text artifact preview reached no ready evidence");
  pass("text artifact ready");
}

if (!lineWith(lines, "[build] detected.format=") && !lineWith(lines, "detected.previewMode=")) {
  fail("preview reached ready without a detected renderer or format");
}
if (!readyEvidence.length && !/trace\.requestID=.* state=completed/u.test(blockText)) {
  fail("preview did not report ready evidence");
}

pass(`${format.id} ready`);
