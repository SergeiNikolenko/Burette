#!/usr/bin/env bun
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
import { Readable } from "node:stream";
import { registerBrowserDevDescriptorRoutes } from "../apps/desktop/vite/browser-dev/descriptors.ts";

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
assert.match(descriptors, /publishGridDescriptorJobFor\(documentId, status\);\s*if \(status\.running\) continue;/);

// Browser-dev computes inline and answers with rows; that path must not start a
// follower, and must keep applying the rows it was given.
assert.match(descriptors, /if \(status\.rows\?\.length\) applyGridDescriptorResults\(documentId, status\.rows\);/);

// A finished run reports exactly once, and a failure has to reach the error
// toast rather than the silent info channel.
assert.match(
  descriptors,
  /status\.status === "failed" \? "error" : status\.status === "completed" \? "success" : "info"/,
);

// The desktop commands key jobs by runtime_document_id ("<window>:<id>") and
// echo that back, while every consumer filters on the id the run started with,
// so a snapshot published unchanged is silently dropped and the status row
// sticks on the locally published event.
assert.match(descriptors, /function publishGridDescriptorJobFor\(documentId: string, status: GridDescriptorJobStatus\)/);
assert.match(descriptors, /publishGridDescriptorJob\(\{ \.\.\.status, documentId \}\)/);
assert.doesNotMatch(descriptors, /publishGridDescriptorJob\(status\)/);
assert.match(descriptorCommands, /runtime_document_id\(window\.label\(\), &document_id\)/);

// Values are written into the collection database, not handed back row by row,
// so the grid is told to re-read whenever a run actually stored something. A
// molecule that cannot be parsed stores an error descriptor and counts as
// failed, not calculated, so gating on calculatedRows would hide a run whose
// every row failed.
assert.match(descriptors, /if \(status\.processedRows > 0\) \{\s*notifyGridDescriptorRunFinished\(/);
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

// descriptor_runtime_install had no caller at all, so a machine without the
// Python runtime had no route to one. Calculate Properties owns that route now,
// and the command follows the model runtime: it starts a worker thread and
// returns, publishes phase/line/error through the status command, and can be
// cancelled through the pid the running step registers.
assert.match(descriptorCommands, /pub\(crate\) fn descriptor_runtime_install\(\) -> Result<\(\), String>/);
assert.match(descriptorCommands, /pub\(crate\) fn descriptor_runtime_cancel_install\(\) -> Result<\(\), String>/);
assert.match(descriptorCommands, /thread::spawn\(\|\| \{\s*let outcome = run_managed_descriptor_install\(\);/);
assert.match(descriptorCommands, /state\.phase = DescriptorInstallPhase::Completed;/);
assert.match(descriptorCommands, /Err\(error\) if state\.cancel_requested => \{\s*state\.phase = DescriptorInstallPhase::Cancelled;/);
assert.match(descriptorCommands, /state\.phase = DescriptorInstallPhase::Failed;/);
assert.match(descriptorCommands, /install_phase: install\.phase\.as_str\(\)/);
assert.match(descriptorCommands, /install_line: install\.line/);
assert.match(descriptorCommands, /install_error: install\.error/);
assert.match(descriptorCommands, /let installer_available = resolve_uv_executable\(\)\.is_ok\(\);/);
assert.match(descriptorCommands, /state\.child_pid = Some\(child\.id\(\)\);/);
assert.match(descriptorCommands, /crate::commands::chemical_space_models::kill_process\(pid\)/);
// A fresh environment compiles RDKit and Mordred on first import, so the probe
// that decides Completed against Failed gets the install budget, not the status
// budget - otherwise a good install reports as broken.
assert.match(
  descriptorCommands,
  /set_descriptor_install_line\("Validating the installed runtime…"\);[\s\S]{0,200}?DESCRIPTOR_INSTALL_TIMEOUT,/,
);
const descriptorsLib = source("apps/desktop/src/lib/descriptors.ts");
assert.match(descriptorsLib, /export async function installDescriptorRuntime\(\): Promise<void>/);
assert.match(descriptorsLib, /export async function cancelDescriptorRuntimeInstall\(\): Promise<void>/);
assert.match(descriptorsLib, /invoke\("descriptor_runtime_cancel_install"\)/);
assert.match(descriptorsLib, /"\/__burette\/descriptors\/cancel-install"/);
const burettePermission = source("apps/desktop/src-tauri/permissions/burette.toml");
for (const command of ["descriptor_runtime_status", "descriptor_runtime_install", "descriptor_runtime_cancel_install"]) {
  assert.ok(burettePermission.includes(`"${command}"`), `${command} must stay permitted`);
}

console.log("descriptor job contract OK");

// Exercise the real private runner with deterministic async boundaries, without
// booting Vite or starting a Python/chemistry workload.
const viteSource = source("apps/desktop/vite.config.ts");
const functions = new Set([
  "calculateBrowserDevGridDescriptors", "browserDevDescriptorJobStatus",
  "browserDevDescriptorValuesFromResult", "normalizeBrowserDevDescriptorRowIndexes", "chunkArray",
]);
const declarations = [...viteSource.matchAll(/^(?:async )?function (\w+)/gm)];
const runnerSource = declarations.flatMap((match, index) => functions.has(match[1])
  ? [viteSource.slice(match.index, declarations[index + 1]?.index ?? viteSource.length)] : []).join("\n");
const runnerJs = new Bun.Transpiler({ loader: "ts" }).transformSync(runnerSource);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture({ records, python, batch } = {}) {
  const jobs = new Map();
  let calls = 0;
  const dependencies = {
    browserDevDescriptorJobs: jobs,
    browserDevDescriptorGridRecords: records ?? (async () => [{ index: 0, name: "ethanol", smiles: "CCO" }]),
    browserDevDescriptorPython: python ?? (async () => "/fixture/python"),
    browserDevDescriptorInstallHint: () => "Install descriptor runtime",
    parseBrowserDevDescriptorRunnerOutput: value => value,
    runBrowserDevDescriptorRunner: (...args) => { calls++; return batch ? batch(...args) : Promise.resolve({ rows: [{ index: 0, ok: true, values: [] }] }); },
    DESCRIPTOR_GRID_BATCH_SIZE: 1,
    DESCRIPTOR_GRID_BATCH_TIMEOUT_MS: 1000,
  };
  const run = new Function(...Object.keys(dependencies), `${runnerJs}; return calculateBrowserDevGridDescriptors;`)(...Object.values(dependencies));
  let route;
  registerBrowserDevDescriptorRoutes({ middlewares: { use(_, handler) { route = handler; } } }, { gridJobs: jobs });
  const cancel = async () => {
    const req = Object.assign(Readable.from([JSON.stringify({ documentId: "collection" })]), { method: "POST", url: "/grid-cancel" });
    const res = { setHeader() {}, end() {} };
    await route(req, res);
    assert.equal(res.statusCode, 200);
    return jobs.get("collection");
  };
  return { run: () => run({ documentId: "collection", path: "/fixture.smi" }), jobs, cancel, calls: () => calls };
}

for (const preparation of ["records", "python"]) {
  const pending = deferred();
  const entered = deferred();
  const test = fixture({ [preparation]: () => { entered.resolve(); return pending.promise; } });
  const result = test.run();
  await entered.promise;
  const cancelled = await test.cancel();
  pending.resolve(preparation === "records" ? [{ index: 0, name: "ethanol", smiles: "CCO" }] : "/fixture/python");
  assert.equal((await result).status, "cancelled");
  assert.equal(test.jobs.get("collection"), cancelled);
  assert.equal(test.calls(), 0, "cancelled preparation must not launch a worker");
}

for (const failure of [false, true]) {
  const pending = deferred();
  const entered = deferred();
  const test = fixture({ batch: () => { entered.resolve(); return pending.promise; } });
  const result = test.run();
  await entered.promise;
  assert.equal((await test.run()).status, "running");
  assert.equal(test.calls(), 1, "a duplicate request must not spawn another worker");
  const cancelled = await test.cancel();
  if (failure) pending.reject(new Error("worker failed after cancellation"));
  else pending.resolve({ rows: [{ index: 0, ok: true, values: [] }] });
  assert.equal((await result).status, "cancelled");
  assert.equal(test.jobs.get("collection"), cancelled, "an in-flight worker must not revive a cancelled run");
}

const failed = fixture({ batch: async () => { throw new Error("worker failed"); } });
assert.equal((await failed.run()).status, "failed");
assert.equal(failed.jobs.get("collection").running, false, "worker failures must not leave a permanent running status");
const successful = fixture();
assert.equal((await successful.run()).status, "completed");
assert.equal(successful.jobs.get("collection").processedRows, 1);
const invalidMolecule = fixture({ batch: async () => ({ rows: [{ index: 0, ok: false, error: "Invalid SMILES" }] }) });
const invalidResult = await invalidMolecule.run();
assert.deepEqual([invalidResult.processedRows, invalidResult.calculatedRows, invalidResult.failedRows], [1, 0, 1]);
assert.equal(invalidResult.summary.calculatedRows, 0);

const oldBatch = deferred();
const oldEntered = deferred();
let generation = 0;
const restarted = fixture({ batch: () => {
  if (++generation === 1) { oldEntered.resolve(); return oldBatch.promise; }
  return Promise.resolve({ rows: [{ index: 0, ok: true, values: [] }] });
} });
const oldRun = restarted.run();
await oldEntered.promise;
await restarted.cancel();
const newRun = await restarted.run();
oldBatch.resolve({ rows: [{ index: 0, ok: false, error: "obsolete result" }] });
assert.equal((await oldRun).status, "cancelled");
assert.equal(restarted.jobs.get("collection"), newRun, "an old batch must not overwrite a restarted job");
console.log("browser-dev descriptor cancellation, duplicate-run, and failure lifecycle checks passed");
