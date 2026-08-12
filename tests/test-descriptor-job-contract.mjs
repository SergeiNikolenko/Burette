#!/usr/bin/env node
// Collection > Calculate Descriptors reached the backend and started the worker,
// but nothing on the host followed the job: descriptor_start_grid returns as soon
// as the thread is spawned, and the only component that polled for the outcome
// was the Descriptors dock panel, deleted in 1090bb89. From then on a run
// published one "running" event and went quiet - no progress, no results in the
// grid, and a failed run raised no toast, because pushStatus only toasts errors
// and no error was ever observed. Nothing failed, which is what made it last.
//
// These assertions pin the three links that have to stay connected: the host
// follows a started job to completion, tells the grid when values landed, and
// the grid re-reads a page so the new columns appear.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const descriptors = source("apps/desktop/src/hooks/use-app-descriptors.ts");
const gridViewer = source("PreviewExtension/Web/grid-viewer.js");
const descriptorCommands = source("apps/desktop/src-tauri/src/commands/descriptors.rs");
const jobStatusCard = source("apps/desktop/src/components/grid-descriptor-status.tsx");

// The desktop command answers with a running job, so the host has to poll it.
// Without this the run is invisible from the moment it starts.
assert.match(descriptors, /gridDescriptorJobStatus/);
assert.match(descriptors, /if \(status\.running\) \{\s*void followGridDescriptorJob\(documentId\);/);
assert.match(descriptors, /const status = await gridDescriptorJobStatus\(documentId\);/);
assert.match(descriptors, /publishGridDescriptorJob\(status\);\s*if \(status\.running\) continue;/);

// Browser-dev computes inline and answers with rows; that path must not start a
// follower, and must keep applying the rows it was given.
assert.match(descriptors, /if \(status\.rows\?\.length\) applyGridDescriptorResults\(documentId, status\.rows\);/);

// A finished run reports exactly once, and a failure has to reach the error
// toast rather than the silent info channel.
assert.match(
  descriptors,
  /status\.status === "failed" \? "error" : status\.status === "completed" \? "success" : "info"/,
);

// Values are written into the collection database, not handed back row by row,
// so the grid is told to re-read whenever a run actually stored something.
assert.match(descriptors, /if \(status\.calculatedRows > 0\) \{\s*notifyGridDescriptorRunFinished\(/);
assert.match(descriptors, /type: "gridDescriptorFinished"/);
assert.match(gridViewer, /body\.type === 'gridDescriptorFinished'/);
assert.match(gridViewer, /function applyDescriptorGridRunFinished\(body, cfg\) \{/);
assert.match(gridViewer, /function applyDescriptorGridRunFinished[\s\S]{0,400}?if \(state\.remoteMode\) void refreshRemote\(cfg\);\s*else refresh\(cfg\);/);

// descriptorIds ride along with the page payload, which is what makes a plain
// page re-read enough to surface the new columns.
assert.match(gridViewer, /state\.remoteDescriptorIds = Array\.isArray\(result\.descriptorIds\)/);

// A second click while a run is in flight returns the same job, so following it
// twice would double every status event.
assert.match(descriptors, /if \(followedJobsRef\.current\.has\(documentId\)\) return;/);
assert.match(descriptors, /followedJobsRef\.current\.delete\(documentId\)/);

// resolve_python_executable only checks for an executable file, so without a
// probe a machine with no managed runtime picks a system python and dies on the
// first batch inside the worker thread, where the caller never sees it.
assert.match(descriptorCommands, /fn resolve_descriptor_engine_python\(\) -> Result<PathBuf, String>/);
assert.match(descriptorCommands, /let python_path = resolve_descriptor_engine_python\(\)\?;/);
// The probe reuses the runtime status command, so "available" stays the single
// definition of whether the engine can actually run.
assert.match(
  descriptorCommands,
  /fn resolve_descriptor_engine_python[\s\S]{0,300}?descriptor_runtime_status\(\);[\s\S]{0,200}?status\.available/,
);
// The hint is the only actionable route left now that the Descriptors panel is
// gone, so it must not send readers back to a panel that no longer exists.
assert.doesNotMatch(descriptorCommands, /from the Descriptors panel/);
assert.match(descriptorCommands, /BURETTE_DESCRIPTOR_PYTHON/);

// The status row is the only descriptor UI still mounted, so it stays the
// consumer of the events the follower publishes.
assert.match(jobStatusCard, /GRID_DESCRIPTOR_JOB_EVENT/);

console.log("descriptor job contract OK");
