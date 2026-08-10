#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

import {
  buildMvsStory,
  readMvsStoryFile,
  validateMvsDocumentFile,
  validateMvsStory,
  validateMvsStoryFile,
  writeMvsStoryFile,
} from "../scripts/mvs-story.mjs";
import { instantiateMvsStoryTemplate, listMvsStoryTemplates } from "../scripts/mvs-story-templates.mjs";
import { getOfficialMvsAuthoringReference } from "../scripts/mvs-schema-validator.mjs";

function findNodes(root, kind) {
  const nodes = [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (value.kind === kind) nodes.push(value);
    Object.values(value).forEach(visit);
  };
  visit(root);
  return nodes;
}

const root = {
  kind: "root",
  children: [{
    kind: "download",
    params: { url: "protein.pdb" },
    children: [{ kind: "parse", params: { format: "pdb" } }],
  }],
};

const story = buildMvsStory({
  title: "Protein tour",
  steps: [
    { key: "overview", title: "Overview", description: "# Overview", root },
    { key: "site", title: "Binding site", description: "# Site", root, transitionDurationMs: 250 },
  ],
}, { now: new Date("2026-07-29T00:00:00.000Z") });

const portableStory = structuredClone(story);
for (const snapshot of portableStory.snapshots) {
  snapshot.root.children[0].params.url = "https://example.org/protein.pdb";
}

assert.equal(story.kind, "multiple");
assert.equal(story.snapshots.length, 2);
assert.equal(story.snapshots[1].metadata.transition_duration_ms, 250);
assert.equal(story.metadata.timestamp, "2026-07-29T00:00:00.000Z");
assert.equal(story.metadata.version, "1.0");

const invalidSchema = structuredClone(story);
invalidSchema.snapshots[0].root.children.push({ kind: "not_a_mvs_node", params: {} });
assert.equal(validateMvsStory(invalidSchema).issues[0].code, "MVS_SCHEMA_INVALID");

const missing = validateMvsStory(story, { resourceNames: [], requireBundledResources: true });
assert.equal(missing.ok, false);
assert.equal(missing.issues[0].code, "MISSING_RESOURCE");

const valid = validateMvsStory(story, { resourceNames: ["protein.pdb"], requireBundledResources: true });
assert.equal(valid.ok, true);
assert.equal(valid.summary.stepCount, 2);
assert.equal(valid.summary.resourceCount, 1);

const duplicate = structuredClone(story);
duplicate.snapshots[1].metadata.key = "overview";
assert.equal(validateMvsStory(duplicate).issues[0].code, "DUPLICATE_KEY");

const unsafe = structuredClone(story);
unsafe.snapshots[0].root.children[0].params.url = "../private.pdb";
assert.equal(validateMvsStory(unsafe).issues[0].code, "UNSAFE_RESOURCE_PATH");

const unsafeScheme = structuredClone(story);
unsafeScheme.snapshots[0].root.children[0].params.url = "file:///tmp/private.pdb";
assert.equal(validateMvsStory(unsafeScheme).issues[0].code, "UNSAFE_RESOURCE_URL");

const dotSlashResource = structuredClone(story);
dotSlashResource.snapshots[0].root.children[0].params.url = "./assets/protein.pdb";
dotSlashResource.snapshots[1].root.children[0].params.url = "./assets/protein.pdb";
assert.equal(validateMvsStory(dotSlashResource, { resourceNames: ["./assets/protein.pdb"], requireBundledResources: true }).ok, true);

const uriStory = buildMvsStory({
  title: "URI resources",
  steps: [{
    key: "primitives",
    title: "Primitives",
    root: { kind: "root", children: [{ kind: "primitives_from_uri", params: { uri: "annotations/primitives.json", format: "mvs-node-json" } }] },
  }],
});
assert.equal(validateMvsStory(uriStory, { resourceNames: [], requireBundledResources: true }).issues.some(issue => issue.code === "MISSING_RESOURCE"), true);
assert.equal(validateMvsStory(uriStory, { resourceNames: ["annotations/primitives.json"], requireBundledResources: true }).ok, true);

const sceneReference = getOfficialMvsAuthoringReference();
assert.equal(sceneReference.schemaKind, "scene");
assert.equal(sceneReference.specVersion, "1");
assert.equal(sceneReference.nodeKinds.length, 30);
assert.equal(sceneReference.nodeKinds.includes("volume_representation"), true);
assert.equal(sceneReference.officialDocs.animations, "https://molstar.org/mol-view-spec-docs/animations/");
const componentReference = getOfficialMvsAuthoringReference({ nodeKind: "component" });
assert.match(componentReference.markdown, /## `component`/);
assert.match(componentReference.markdown, /Parent: `structure`/);
assert.match(componentReference.markdown, /selector/);
const animationReference = getOfficialMvsAuthoringReference({ schema: "animation", nodeKind: "interpolate" });
assert.deepEqual(animationReference.nodeKinds, ["animation", "interpolate"]);
assert.match(animationReference.markdown, /## `interpolate`/);
assert.throws(
  () => getOfficialMvsAuthoringReference({ nodeKind: "unknown_node" }),
  error => error.code === "MVS_NODE_NOT_FOUND" && error.details.availableNodeKinds.includes("component"),
);

const templates = await listMvsStoryTemplates();
assert.deepEqual(templates.map(template => template.id), [
  "aligned-structure-comparison",
  "binding-site-tour",
  "docking-pose-comparison",
  "structure-overview",
]);
for (const template of templates) {
  assert.equal(template.caveats.length > 0, true);
  assert.equal(template.storyboard.length > 0, true);
  const variables = Object.fromEntries(template.variables
    .filter(variable => variable.required)
    .map(variable => [variable.name, variable.example]));
  const instantiated = await instantiateMvsStoryTemplate(template.id, variables, { now: new Date("2026-07-29T00:00:00.000Z") });
  assert.equal(instantiated.summary.stepCount, template.storyboard.length);
  assert.equal(validateMvsStory(instantiated.story).ok, true, template.id);
}
const dockingTemplate = templates.find(template => template.id === "docking-pose-comparison");
assert.deepEqual(
  dockingTemplate.variables.filter(variable => variable.required && variable.name.includes("interactions")).map(variable => variable.name),
  [
    "pose_a_interactions_url",
    "pose_b_interactions_url",
    "pose_a_interactions_summary",
    "pose_b_interactions_summary",
  ],
);
assert.deepEqual(
  dockingTemplate.variables.filter(variable => variable.required && variable.name.includes("residues_url")).map(variable => variable.name),
  ["pose_a_residues_url", "pose_b_residues_url"],
);
const dockingVariables = Object.fromEntries(dockingTemplate.variables
  .filter(variable => variable.required)
  .map(variable => [variable.name, variable.example]));
const dockingStory = (await instantiateMvsStoryTemplate("docking-pose-comparison", dockingVariables)).story;
for (const [key, expectedInteractionUrls] of [
  ["pose-a", ["pose-a-interactions.json"]],
  ["pose-b", ["pose-b-interactions.json"]],
]) {
  const snapshot = dockingStory.snapshots.find(candidate => candidate.metadata.key === key);
  const interactionLayers = snapshot.root.children.filter(node => node.kind === "primitives_from_uri");
  const residueLayers = findNodes(snapshot.root, "component_from_uri");
  const residueTooltips = findNodes(snapshot.root, "tooltip_from_uri");
  assert.deepEqual(interactionLayers.map(node => node.params.uri), expectedInteractionUrls, `${key} must keep its key-interaction layers visible`);
  assert.equal(interactionLayers.every(node => node.params.format === "mvs-node-json"), true);
  assert.deepEqual(residueLayers.map(node => node.params.uri), [`${key}-residues.json`], `${key} must render the receptor residues at interaction endpoints`);
  assert.equal(residueLayers.every(node => node.children.some(child => child.kind === "representation" && child.params.type === "ball_and_stick")), true);
  assert.deepEqual(residueTooltips.map(node => node.params.uri), [`${key}-residues.json`], `${key} must identify visible interaction residues on hover`);
  assert.match(snapshot.metadata.description, /Key interactions|required key-interaction layers/);
}
const dockingComparison = dockingStory.snapshots.find(candidate => candidate.metadata.key === "comparison");
assert.equal(dockingComparison.root.children.some(node => node.kind === "primitives_from_uri"), false, "the overlay keeps geometry readable instead of duplicating both interaction layers");
assert.match(dockingComparison.metadata.description, /dedicated pose steps show the required 3D key-interaction layers/);
await assert.rejects(
  instantiateMvsStoryTemplate("binding-site-tour", { protein_url: "protein.pdb" }),
  error => error.code === "MISSING_TEMPLATE_VARIABLE" && error.details.variable === "ligand_url",
);
await assert.rejects(
  instantiateMvsStoryTemplate("binding-site-tour", { protein_url: "protein.pdb", ligand_url: "ligand.sdf", surprise: "value" }),
  error => error.code === "UNKNOWN_TEMPLATE_VARIABLE",
);

const missingSidecars = spawnSync(process.execPath, [
  "scripts/burette-agent.mjs",
  "open",
  "--mode",
  "browser-agent-shell",
  "samples/mvs/docking_story.mvsj",
], { encoding: "utf8" });
assert.equal(missingSidecars.status, 1);
assert.equal(JSON.parse(missingSidecars.stderr).error.code, "STORY_RESOURCE_MISSING");

const temp = await mkdtemp(path.join(tmpdir(), "burette-mvs-story-test-"));
try {
  const mvsj = path.join(temp, "protein-tour.mvsj");
  const mvsx = path.join(temp, "protein-tour.mvsx");
  const asset = path.resolve("samples/mini.pdb");
  const ligandAsset = path.resolve("samples/mini.sdf");
  const interactionPrimitive = path.join(temp, "interactions.json");
  const emptyInteractionPrimitive = path.join(temp, "empty-interactions.json");
  const interactionResidues = path.join(temp, "interaction-residues.json");
  const emptyInteractionResidues = path.join(temp, "empty-interaction-residues.json");
  await writeFile(interactionPrimitive, `${JSON.stringify({
    kind: "primitives",
    params: { opacity: 0.92 },
    children: [{
      kind: "primitive",
      params: {
        kind: "distance_measurement",
        start: [0, 0, 0],
        end: [1, 1, 1],
        radius: 0.035,
        dash_length: 0.12,
        color: "#2563EB",
        label_template: "H-bond candidate · THR101 · {{distance}}",
        label_color: "#2563EB",
      },
    }],
  }, null, 2)}\n`);
  await writeFile(emptyInteractionPrimitive, `${JSON.stringify({ kind: "primitives", params: {}, children: [] }, null, 2)}\n`);
  await writeFile(interactionResidues, `${JSON.stringify([{ auth_asym_id: "A", auth_seq_id: 101 }], null, 2)}\n`);
  await writeFile(emptyInteractionResidues, "[]\n");

  await assert.rejects(
    writeMvsStoryFile({
      story: dockingStory,
      outputPath: path.join(temp, "docking-without-interactions.mvsx"),
      assets: {
        "receptor.pdb": asset,
        "pose-a.sdf": ligandAsset,
        "pose-b.sdf": ligandAsset,
      },
    }),
    error => error.code === "INVALID_STORY"
      && error.details.issues.some(issue => issue.code === "MISSING_RESOURCE" && issue.details.resource === "pose-a-interactions.json"),
  );
  await assert.rejects(
    writeMvsStoryFile({
      story: dockingStory,
      outputPath: path.join(temp, "docking-with-empty-interactions.mvsx"),
      assets: {
        "receptor.pdb": asset,
        "pose-a.sdf": ligandAsset,
        "pose-b.sdf": ligandAsset,
        "pose-a-interactions.json": emptyInteractionPrimitive,
        "pose-b-interactions.json": interactionPrimitive,
        "pose-a-residues.json": interactionResidues,
        "pose-b-residues.json": interactionResidues,
      },
    }),
    error => error.code === "INVALID_PRIMITIVE_RESOURCE"
      && error.details.resource === "pose-a-interactions.json",
  );
  await assert.rejects(
    writeMvsStoryFile({
      story: dockingStory,
      outputPath: path.join(temp, "docking-with-empty-residues.mvsx"),
      assets: {
        "receptor.pdb": asset,
        "pose-a.sdf": ligandAsset,
        "pose-b.sdf": ligandAsset,
        "pose-a-interactions.json": interactionPrimitive,
        "pose-b-interactions.json": interactionPrimitive,
        "pose-a-residues.json": emptyInteractionResidues,
        "pose-b-residues.json": interactionResidues,
      },
    }),
    error => error.code === "INVALID_ANNOTATION_RESOURCE"
      && error.details.resource === "pose-a-residues.json",
  );
  const dockingArchive = path.join(temp, "docking-with-interactions.mvsx");
  await writeMvsStoryFile({
    story: dockingStory,
    outputPath: dockingArchive,
    assets: {
      "receptor.pdb": asset,
      "pose-a.sdf": ligandAsset,
      "pose-b.sdf": ligandAsset,
      "pose-a-interactions.json": interactionPrimitive,
      "pose-b-interactions.json": interactionPrimitive,
      "pose-a-residues.json": interactionResidues,
      "pose-b-residues.json": interactionResidues,
    },
  });
  const validatedDockingArchive = await validateMvsStoryFile(dockingArchive);
  assert.equal(validatedDockingArchive.ok, true, JSON.stringify(validatedDockingArchive.issues));
  assert.deepEqual(validatedDockingArchive.resourceNames.sort(), [
    "pose-a-interactions.json",
    "pose-a-residues.json",
    "pose-a.sdf",
    "pose-b-interactions.json",
    "pose-b-residues.json",
    "pose-b.sdf",
    "receptor.pdb",
  ]);

  const templateList = spawnSync(process.execPath, ["scripts/burette-agent.mjs", "story-template-list"], { encoding: "utf8" });
  assert.equal(templateList.status, 0, templateList.stderr);
  assert.equal(JSON.parse(templateList.stdout).result.count, 4);

  const schemaOverview = spawnSync(process.execPath, ["scripts/burette-agent.mjs", "story-schema", "--schema", "scene"], { encoding: "utf8" });
  assert.equal(schemaOverview.status, 0, schemaOverview.stderr);
  assert.equal(JSON.parse(schemaOverview.stdout).result.nodeKinds.includes("primitive"), true);
  const schemaNode = spawnSync(process.execPath, ["scripts/burette-agent.mjs", "story-schema", "--schema", "scene", "--node", "camera"], { encoding: "utf8" });
  assert.equal(schemaNode.status, 0, schemaNode.stderr);
  assert.match(JSON.parse(schemaNode.stdout).result.markdown, /position/);
  const missingSchemaNode = spawnSync(process.execPath, ["scripts/burette-agent.mjs", "story-schema", "--node", "missing"], { encoding: "utf8" });
  assert.equal(missingSchemaNode.status, 1);
  assert.equal(JSON.parse(missingSchemaNode.stderr).error.code, "MVS_NODE_NOT_FOUND");

  const templatedMvsx = path.join(temp, "binding-site-tour.mvsx");
  const templateCreate = spawnSync(process.execPath, [
    "scripts/burette-agent.mjs",
    "story-template-create",
    "--template", "binding-site-tour",
    "--output", templatedMvsx,
    "--var", "protein_url=protein.pdb",
    "--var", "ligand_url=ligand.sdf",
    "--var", "complex_label=Template smoke",
    "--asset", `protein.pdb=${asset}`,
    "--asset", `ligand.sdf=${ligandAsset}`,
  ], { encoding: "utf8" });
  assert.equal(templateCreate.status, 0, templateCreate.stderr);
  assert.equal(JSON.parse(templateCreate.stdout).result.template.id, "binding-site-tour");
  const validatedTemplate = await validateMvsStoryFile(templatedMvsx);
  assert.equal(validatedTemplate.ok, true, JSON.stringify(validatedTemplate.issues));
  assert.equal(validatedTemplate.summary.stepCount, 3);

  const encodedTraversalStory = structuredClone(story);
  encodedTraversalStory.snapshots[0].root.children[0].params.url = "assets/%2e%2e/private.pdb";
  encodedTraversalStory.snapshots[1].root.children[0].params.url = "assets/%2e%2e/private.pdb";
  await assert.rejects(
    writeMvsStoryFile({
      story: encodedTraversalStory,
      outputPath: path.join(temp, "encoded-traversal.mvsx"),
      assets: { "assets/%2e%2e/private.pdb": asset },
    }),
    error => error.code === "UNSAFE_RESOURCE_PATH",
  );

  const singleMvsj = path.join(temp, "single.mvsj");
  const singleDocument = JSON.parse(await readFile("tests/fixtures/file-kinds/scene.mvsj", "utf8"));
  singleDocument.root.children[0].params.url = "https://example.org/receptor.pdb";
  await writeFile(singleMvsj, `${JSON.stringify(singleDocument, null, 2)}\n`);
  assert.equal((await validateMvsDocumentFile(singleMvsj)).ok, true);
  const singleOpen = spawnSync(process.execPath, [
    "scripts/burette-agent.mjs", "open", "--mode", "desktop-app", "--no-launch", "--session-dir", path.join(temp, "single-session"), singleMvsj,
  ], { encoding: "utf8" });
  assert.equal(singleOpen.status, 0, singleOpen.stderr);

  await assert.rejects(
    writeMvsStoryFile({ story, outputPath: mvsj }),
    error => error.code === "INVALID_STORY"
      && error.details.issues.some(issue => issue.code === "RELATIVE_RESOURCE_REQUIRES_MVSX"),
  );
  const writtenJson = await writeMvsStoryFile({ story: portableStory, outputPath: mvsj });
  assert.equal(writtenJson.ok, true);
  assert.equal(writtenJson.format, "mvsj");
  const validatedJson = await validateMvsStoryFile(mvsj);
  assert.equal(validatedJson.ok, true);
  assert.equal(validatedJson.warnings.length, 0);

  const writtenArchive = await writeMvsStoryFile({
    story,
    outputPath: mvsx,
    assets: { "protein.pdb": asset },
  });
  assert.equal(writtenArchive.ok, true);
  assert.equal(writtenArchive.format, "mvsx");
  const loadedArchive = await readMvsStoryFile(mvsx);
  assert.deepEqual(loadedArchive.resourceNames, ["protein.pdb"]);
  assert.equal(loadedArchive.story.snapshots[1].metadata.key, "site");
  const validatedArchive = await validateMvsStoryFile(mvsx);
  assert.equal(validatedArchive.ok, true);
  assert.equal(validatedArchive.warnings.length, 0);

  const officialMvsModule = await import("molstar/lib/commonjs/extensions/mvs/mvs-data.js");
  const officialMvsx = await officialMvsModule.default.MVSData.toMVSX(story, {
    assets: { "protein.pdb": new Uint8Array(await readFile(asset)) },
  });
  const officialMvsxPath = path.join(temp, "official-export.mvsx");
  await writeFile(officialMvsxPath, officialMvsx);
  const validatedOfficialMvsx = await validateMvsStoryFile(officialMvsxPath);
  assert.equal(validatedOfficialMvsx.ok, true, JSON.stringify(validatedOfficialMvsx.issues));

  const corruptMvsx = path.join(temp, "corrupt.mvsx");
  const corruptBytes = Buffer.from(await readFile(mvsx));
  const assetOffset = corruptBytes.indexOf(Buffer.from("ATOM"));
  assert.notEqual(assetOffset, -1);
  corruptBytes[assetOffset] ^= 0xff;
  await writeFile(corruptMvsx, corruptBytes);
  assert.equal((await validateMvsStoryFile(corruptMvsx)).issues[0].code, "INVALID_ARCHIVE");

  const compressedBomb = path.join(temp, "compressed-bomb.mvsx");
  await writeFile(compressedBomb, deflatedZipEntry("index.mvsj", Buffer.alloc(2 * 1024 * 1024)));
  await assert.rejects(
    readMvsStoryFile(compressedBomb),
    error => error.code === "SUSPICIOUS_COMPRESSION_RATIO",
  );

  const tooManyAssets = Object.fromEntries(Array.from({ length: 1024 }, (_, index) => [`asset-${index}.pdb`, asset]));
  await assert.rejects(
    writeMvsStoryFile({ story: { ...story, snapshots: story.snapshots.map(snapshot => ({ ...snapshot, root: { kind: "root" } })) }, outputPath: path.join(temp, "too-many.mvsx"), assets: tooManyAssets }),
    error => error.code === "TOO_MANY_ENTRIES",
  );

  await assert.rejects(
    writeMvsStoryFile({ story, outputPath: path.join(temp, "long-path.mvsx"), assets: { [`${"x".repeat(4097)}.pdb`]: asset } }),
    error => error.code === "RESOURCE_PATH_TOO_LONG",
  );

  const oversizedStory = buildMvsStory({
    title: "Oversized",
    steps: Array.from({ length: 140 }, (_, index) => ({ key: `step-${index}`, title: `Step ${index}`, description: "x".repeat(64 * 1024), root: { kind: "root" } })),
  });
  await assert.rejects(
    writeMvsStoryFile({ story: oversizedStory, outputPath: path.join(temp, "oversized.mvsj") }),
    error => error.code === "STORY_TOO_LARGE",
  );

  await assert.rejects(
    writeMvsStoryFile({ story, outputPath: mvsx, assets: { "protein.pdb": asset } }),
    error => error.code === "OUTPUT_EXISTS",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("MolViewSpec Story tests passed");

function deflatedZipEntry(name, data) {
  const nameBytes = Buffer.from(name);
  const compressed = deflateRawSync(data);
  const local = Buffer.alloc(30 + nameBytes.length + compressed.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);
  compressed.copy(local, 30 + nameBytes.length);
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  nameBytes.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}
