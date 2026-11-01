// Python client → packaged CLI → HTTP session server → production host hook → controller → workers.
// Expected numbers come from Python RDKit (fixtures/optimization) and RDKit's own UFF fixture.
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Window } from "happy-dom";
import React, { act } from "react";
import type { ViewerDocument } from "../apps/desktop/src/types";
import { parseMolecule } from "../apps/desktop/src/lib/molecular-workbench/chemistry";
import { mcpPropertiesClient } from "./fixtures/typed-properties-host";
import reference from "./fixtures/optimization/rdkit-optimization-reference.json";

// The browser agent shell build sets this flag; the hook stays idle without it.
plugin({ name: "agent-shell-build-flag", setup(build) {
  build.onLoad({ filter: /use-agent-session\.ts$/u }, ({ path }) => ({ contents: readFileSync(path, "utf8").replace("import.meta.env.VITE_BURETTE_AGENT_SHELL", '"1"'), loader: "ts" }));
} });
const browser = new Window({ url: "http://localhost/" });
const prior = new Map<string, PropertyDescriptor | undefined>();
function install(key: string, value: unknown) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, CSS: browser.CSS, localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) install(key, value);
// Happy DOM has no EventSource; this adapter only consumes the real server's SSE stream.
class HttpEvents extends EventTarget {
  abort = new AbortController();
  constructor(url: string) { super(); void fetch(url, { signal: this.abort.signal }).then(async response => {
    const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = "";
    while (!this.abort.signal.aborted) {
      const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      let boundary: number; while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const packet = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const name = /^event: (.+)$/mu.exec(packet)?.[1]; if (name) this.dispatchEvent(new Event(name));
      }
    }
  }).catch(error => { if (!this.abort.signal.aborted) throw error; }); }
  close() { this.abort.abort(); }
}
install("EventSource", HttpEvents);
// Tab navigation and Ketcher are outside the workbench; everything on the job route is real.
const pageKinds = await import("../apps/desktop/src/components/editor-area/page-kinds"), ketcherAgent = await import("../apps/desktop/src/lib/ketcher-agent");
mock.module("../apps/desktop/src/components/editor-area/page-kinds", () => ({ ...pageKinds, deserializeLocation: () => null, serializeLocation: () => null }));
mock.module("../apps/desktop/src/lib/ketcher-agent", () => ({ ...ketcherAgent, subscribeKetcherAgentRegistry: () => () => {} }));
const { createRoot } = await import("react-dom/client");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { useAgentSession } = await import("../apps/desktop/src/hooks/use-agent-session");

const repo = resolve(import.meta.dir, ".."), node = Bun.which("node")!, originalFetch = globalThis.fetch;
const fixture = (name: string) => readFileSync(join(repo, "tests/fixtures/automation", name), "utf8");
const water = JSON.parse(readFileSync(join(repo, "compute/rdkit-conformer/fixtures/uff-rdkit-2025.03.4.json"), "utf8")).cases.find((item: { name: string }) => item.name === "water");
const ethanol = reference.records.find(item => item.smiles === "CCO")!;
let root = "", session = "", draft: string | null = null, documents: ViewerDocument[] = [];
let server: ReturnType<typeof spawn>, mounted: ReturnType<typeof createRoot>;
const hookErrors: unknown[] = [];
function Probe() {
  useAgentSession({ activeDocument: documents[0], documents, activeTabId: "tab", activeTabKind: "document", tabs: [],
    tabActions: { openNewTab() {}, setActiveTab() {}, closeTab() {}, moveTab() {} }, openDockingDocument: async () => null,
    openPaths() {}, openKetcherTab() {}, openTextDocuments: async () => null, pushErrorStatus(error) { hookErrors.push(error); }, setDockDocument() {},
    sourceDraftForDocument: () => draft }); return null;
}
async function open(name: string) {
  const text = fixture(name), extension = name.split(".").pop()!, path = join(root, name); await writeFile(path, text);
  documents = [{ id: name, path, title: name, extension, renderer: "molstar", byteCount: Buffer.byteLength(text), runtimePath: "viewer" }];
  useMoleculeStore.setState({ documents }); await act(async () => mounted.render(<Probe />)); return text;
}
// One Python process per step; its last stdout line is the JSON it printed. The package
// resolves the CLI next to itself, exactly as the packaged plugin ships it.
function python(body: string) {
  const script = `import json, sys\nfrom burette_workbench import Workbench, WorkbenchError\nwb = Workbench(sys.argv[1], wait_ms=10000)\ndef code(call):\n    try:\n        call()\n    except WorkbenchError as error:\n        return error.code\n    return None\n${body}`;
  return new Promise<any>((done, reject) => {
    const child = spawn("python3", ["-", session], { cwd: root, env: { ...process.env, PYTHONPATH: join(repo, "plugins/burette-agent/python"), BURETTE_NODE: node, PYTHONDONTWRITEBYTECODE: "1" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", reject); child.on("close", status => status === 0 ? done(JSON.parse(stdout.trim().split("\n").at(-1)!)) : reject(new Error(stderr || stdout)));
    child.stdin.end(script);
  });
}
const sha256 = (bytes: Buffer) => `sha256-${createHash("sha256").update(bytes).digest("hex")}`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "burette-python-client-")); session = join(root, "session");
  await Promise.all([mkdir(session), mkdir(join(root, "dist"))]); await writeFile(join(root, "dist/index.html"), "<!doctype html><title>Agent fixture</title>");
  const listener = createServer(); await new Promise<void>(done => listener.listen(0, "127.0.0.1", done));
  const port = (listener.address() as { port: number }).port; await new Promise(done => listener.close(done));
  const baseUrl = `http://127.0.0.1:${port}`, token = randomUUID();
  await writeFile(join(session, "session.json"), JSON.stringify({ apiVersion: "burette-agent-cli/v1", mode: "browser-dev-shell", token, createdAt: new Date().toISOString(), initialPaths: [], allowedRoots: [root], sessionDir: session, host: "127.0.0.1", port, url: `${baseUrl}/?shellToken=${token}` }));
  await writeFile(join(session, "actions.json"), JSON.stringify({ apiVersion: "burette-agent-control/v1", actions: [] }));
  server = spawn(node, [join(repo, "plugins/burette-agent/scripts/agent-shell-server.mjs"), "--dist", join(root, "dist"), "--session-dir", session, "--allow", root, "--host", "127.0.0.1", "--port", String(port)], { cwd: repo, stdio: "ignore" });
  for (let i = 0; i < 100; i++) { if (await originalFetch(baseUrl + "/healthz").then(r => r.ok, () => false)) break; await Bun.sleep(25); }
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => originalFetch(typeof url === "string" ? new URL(url, baseUrl) : url,
    { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } })) as typeof fetch;
  mounted = createRoot(document.body.appendChild(document.createElement("div")));
  await open("ethanol.sdf");
  for (let i = 0; i < 100; i++) { if (await readFile(join(session, "observe.json")).then(() => true, () => false)) break; await Bun.sleep(10); }
});
afterAll(async () => {
  if (mounted) await act(async () => mounted.unmount()); await Bun.sleep(20);
  server?.kill("SIGTERM"); globalThis.fetch = originalFetch;
  for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  if (root) await rm(root, { recursive: true, force: true });
});

test("a Python notebook client observes, pages atoms, runs a constrained optimization and exports exact artifacts", async () => {
  const source = parseMolecule(fixture("ethanol.sdf"), "sdf");
  const report = await python(`
doc = wb.observe()
atoms = list(wb.iter_atoms())
job = wb.run("optimize", {"forceField": "UFF", "constraints": [{"kind": "freeze", "atoms": [0]}]})
exported = wb.export(job.job_id, "structure", "optimized.sdf")
built = wb.build("peptide", {"sequence": "AG"})
print(json.dumps({
  "built": built.raw, "builtExport": wb.export(built.job_id, "structure", "ag.cif"), "misrouted": code(lambda: wb.build("energy", {})),
  "jobs": list(wb.capabilities()["jobs"]), "structure": doc["structure"], "atoms": atoms, "job": job.raw, "exported": exported,
  "replayed": wb.submit("optimize", job.params, expected_source_revision=doc["sourceRevision"], operation_id=job.operation_id).job_id,
  "conflict": code(lambda: wb.submit("optimize", {"method": "fire"}, expected_source_revision=doc["sourceRevision"], operation_id=job.operation_id)),
  "exists": code(lambda: wb.export(job.job_id, "structure", "optimized.sdf")),
  "stale": code(lambda: wb.submit("energy", {}, expected_source_revision="sha256-" + "a" * 64)),
  "invalid": code(lambda: wb.submit("optimize", {"method": "steepest"}, expected_source_revision=doc["sourceRevision"])),
  "unavailable": code(lambda: wb.run("optimize", {"forceField": "UFF", "method": "bfgs"})),
  "unknown": code(lambda: wb.submit("point_group", {}, expected_source_revision=doc["sourceRevision"])),
}))`);
  expect(report.jobs).toEqual(["properties", "energy", "energy_forces", "frame_energy_forces", "optimize", "prepare_3d", "conformers", "metadata_edit", "pair_distribution", "orbital_cube", "insert_fragment", "hydrogens", "polymer", "smiles", "peptide"]);
  expect([report.structure.atomCount, report.atoms.map((atom: any) => atom.element)]).toEqual([9, source.atoms.map(atom => atom.element)]);
  report.atoms.forEach((atom: any, i: number) => expect([atom.x, atom.y, atom.z]).toEqual([source.atoms[i].x, source.atoms[i].y, source.atoms[i].z]));
  expect(report.job).toMatchObject({ status: "succeeded", binding: "current", params: { method: "lbfgs" }, summary: { method: "lbfgs", forceField: "UFF", converged: true, frozenAtoms: [0], frameSampling: "steps" } });
  expect(Math.abs(report.job.summary.energy - ethanol.models.UFF.minimum.energy)).toBeLessThan(1e-3);
  const bytes = await readFile(report.exported.path), optimized = parseMolecule(bytes.toString("utf8"), "sdf");
  expect([bytes.length, sha256(bytes), report.exported.content]).toEqual([report.exported.byteCount, report.exported.sha256, undefined]);
  expect([optimized.bonds, optimized.atoms[0]]).toEqual([source.bonds, source.atoms[0]]);
  expect(report).toMatchObject({ replayed: report.job.jobId, conflict: "OPERATION_ID_CONFLICT", exists: "OUTPUT_EXISTS", stale: "REVISION_CONFLICT", invalid: "INVALID_ARGS", unavailable: "JOB_UNAVAILABLE", unknown: "UNSUPPORTED_WORKBENCH_JOB" });
  expect(report.built).toMatchObject({ kind: "peptide", status: "succeeded", binding: "none", documentId: null, sourceRevision: null, summary: { sequence: "AG", residueCount: 2 } });
  expect([report.misrouted, (await readFile(report.builtExport.path, "utf8")).includes("_atom_site.")]).toEqual(["INVALID_ARGS", true]);
  expect(hookErrors).toEqual([]);
}, 60_000);

test("Python frame batches cover every XYZ frame and SDF record, replay finished batches and stop on an edited source", async () => {
  await open("water-trajectory.xyz");
  const waters = await python(`
first = list(wb.iter_frame_energy_forces("UFF", batch_size=2, operation_prefix="water"))
total = wb.request("jobs")["total"]
again = list(wb.iter_frame_energy_forces("UFF", batch_size=2, operation_prefix="water"))
print(json.dumps({"frames": first, "same": again == first, "jobs": [total, wb.request("jobs")["total"]]}))`);
  // Two batches (2 + 1 frames); the replayed loop reuses both jobs instead of queueing new ones.
  expect([waters.frames.map((frame: any) => frame.frameIndex), waters.same, waters.jobs[1]]).toEqual([[0, 1, 2], true, waters.jobs[0]]);
  for (const frame of waters.frames) expect(Math.abs(frame.energy - water.expectedEnergyKcalMol)).toBeLessThan(1e-6);
  waters.frames[0].forces.flat().forEach((value: number, i: number) => expect(Math.abs(value + water.expectedGradientKcalMolAngstrom[i])).toBeLessThan(1e-4));
  waters.frames[0].forces.forEach((force: number[], i: number) => [-force[1], force[0], force[2]].forEach((value, axis) => expect(Math.abs(value - waters.frames[1].forces[i][axis])).toBeLessThan(1e-4)));

  const ensembleText = await open("ethanol-ensemble.sdf");
  const ensemble = await python(`
print(json.dumps({"frames": list(wb.iter_frame_energy_forces("MMFF94", batch_size=1)), "observed": wb.observe()["frames"]}))`);
  expect([ensemble.observed, ensemble.frames.map((frame: any) => frame.frameIndex)]).toEqual([{ count: 2, source: "sdf-records" }, [0, 1]]);
  expect(Math.abs(ensemble.frames[0].energy - ethanol.models.MMFF94.energy)).toBeLessThan(1e-6);
  expect(Math.abs(ensemble.frames[1].energy - ethanol.models.MMFF94.minimum.energy)).toBeLessThan(1e-6);
  ensemble.frames[0].forces.flat().forEach((value: number, i: number) => expect(Math.abs(value + ethanol.models.MMFF94.gradient[i])).toBeLessThan(2e-4));

  // The revision is pinned before the loop; an edit between batches must stop it.
  const pinned = await python(`
revision = wb.observe()["sourceRevision"]
batch = wb.run("frame_energy_forces", {"count": 1}, expected_source_revision=revision)
print(json.dumps({"revision": revision, "jobId": batch.job_id}))`);
  draft = ensembleText + "\n";
  const edited = await python(`
print(json.dumps({
  "loop": code(lambda: list(wb.iter_frame_energy_forces("MMFF94", expected_source_revision=${JSON.stringify(pinned.revision)}))),
  "status": wb.status(${JSON.stringify(pinned.jobId)}).status,
  "export": code(lambda: wb.export(${JSON.stringify(pinned.jobId)}, "forces")),
  "allowed": wb.export(${JSON.stringify(pinned.jobId)}, "forces", allow_stale=True)["path"],
}))`);
  draft = null;
  expect(edited).toMatchObject({ loop: "REVISION_CONFLICT", status: "stale", export: "STALE_RESULT" });
  expect(JSON.parse(await readFile(edited.allowed, "utf8")).frames[0].frameIndex).toBe(0);
  expect(hookErrors).toEqual([]);
}, 90_000);

test("Python cancel and the stdio MCP tool share one job registry", async () => {
  await open("n-methylacetamide.sdf");
  const mcp = await mcpPropertiesClient(repo);
  try {
    const cancelled = await python(`
doc = wb.observe()
job = wb.submit("optimize", {"method": "fire", "maxIterations": 1000}, expected_source_revision=doc["sourceRevision"], operation_id="shared-run")
print(json.dumps({"cancelled": wb.cancel(job.job_id).raw, "revision": doc["sourceRevision"]}))`);
    expect(cancelled.cancelled).toMatchObject({ status: "cancelled", summary: null, artifacts: [] });
    const replay = await mcp.control(session, { operation: "submit", operationId: "shared-run", expectedSourceRevision: cancelled.revision, job: { kind: "optimize", params: { method: "fire", maxIterations: 1000 } } });
    expect(replay.structuredContent.result.action.result.result).toMatchObject({ deduplicated: true, job: { jobId: cancelled.cancelled.jobId, status: "cancelled" } });
    const prepared = await mcp.control(session, { operation: "submit", operationId: "mcp-3d", expectedSourceRevision: cancelled.revision, job: { kind: "prepare_3d", params: {} } });
    expect(prepared.structuredContent.error.code).toBe("JOB_UNAVAILABLE");
    const status = await python(`print(json.dumps(wb.status(${JSON.stringify(cancelled.cancelled.jobId)}).raw))`);
    expect(status).toMatchObject({ status: "cancelled", operationId: "shared-run" });
  } finally { mcp.close(); }
  expect(hookErrors).toEqual([]);
}, 60_000);
