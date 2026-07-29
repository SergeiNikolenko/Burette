#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildMvsStory,
  readMvsStoryFile,
  validateMvsDocumentFile,
  validateMvsStory,
  validateMvsStoryFile,
  writeMvsStoryFile,
} from "../scripts/mvs-story.mjs";
import { instantiateMvsStoryTemplate, listMvsStoryTemplates } from "../scripts/mvs-story-templates.mjs";

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

  const templateList = spawnSync(process.execPath, ["scripts/burette-agent.mjs", "story-template-list"], { encoding: "utf8" });
  assert.equal(templateList.status, 0, templateList.stderr);
  assert.equal(JSON.parse(templateList.stdout).result.count, 4);

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
    "--asset", `ligand.sdf=${path.resolve("samples/mini.sdf")}`,
  ], { encoding: "utf8" });
  assert.equal(templateCreate.status, 0, templateCreate.stderr);
  assert.equal(JSON.parse(templateCreate.stdout).result.template.id, "binding-site-tour");
  const validatedTemplate = await validateMvsStoryFile(templatedMvsx);
  assert.equal(validatedTemplate.ok, true, JSON.stringify(validatedTemplate.issues));
  assert.equal(validatedTemplate.summary.stepCount, 3);

  const singleMvsj = path.join(temp, "single.mvsj");
  const singleDocument = JSON.parse(await readFile("tests/fixtures/file-kinds/scene.mvsj", "utf8"));
  await writeFile(singleMvsj, `${JSON.stringify(singleDocument, null, 2)}\n`);
  await writeFile(path.join(temp, "receptor.pdb"), await readFile(asset));
  assert.equal((await validateMvsDocumentFile(singleMvsj)).ok, true);
  const singleOpen = spawnSync(process.execPath, [
    "scripts/burette-agent.mjs", "open", "--mode", "desktop-app", "--no-launch", "--session-dir", path.join(temp, "single-session"), singleMvsj,
  ], { encoding: "utf8" });
  assert.equal(singleOpen.status, 0, singleOpen.stderr);

  const writtenJson = await writeMvsStoryFile({ story, outputPath: mvsj });
  assert.equal(writtenJson.ok, true);
  assert.equal(writtenJson.format, "mvsj");
  const validatedJson = await validateMvsStoryFile(mvsj);
  assert.equal(validatedJson.ok, true);
  assert.equal(validatedJson.warnings[0].code, "MISSING_RESOURCE");

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
