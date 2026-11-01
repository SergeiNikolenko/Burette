import { amideReference, waterReference, energyCases } from "./fixtures/typed-energy-host";
import { builtPropertiesWorkers, mcpPropertiesClient, propertyCases } from "./fixtures/typed-properties-host";
// Actual compiled host hook → HTTP session server → CLI subprocess → numerical workers.
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { plugin } from "bun";
import { transformSync } from "@babel/core";
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
import { parseScientificFile } from "../apps/desktop/src/lib/molecular-workbench/quantum";
import { addDocumentInternalCoordinates, importedOriginalFor, releaseClosedImports } from "../apps/desktop/src/lib/workbench/scientific-source-state";

plugin({ name: "orbital-agent-production-compiler", setup(build) {
  build.onLoad({ filter: /use-agent-session\.ts$/u }, ({ path }) => {
    const source = readFileSync(path, "utf8").replace('import.meta.env.VITE_BURETTE_AGENT_SHELL', '"1"');
    const code = transformSync(source, { filename: path, babelrc: false, configFile: false,
      parserOpts: { plugins: ["typescript"] }, plugins: [["babel-plugin-react-compiler", {}]] })?.code;
    if (!code) throw new Error("React compiler returned no code");
    console.log(JSON.stringify({ module: "use-agent-session.ts", compilerCacheEmitted: code.includes("react/compiler-runtime") }));
    return { contents: code, loader: "ts" };
  });
} });
const browser = new Window({ url: "http://localhost/" });
const prior = new Map<string, PropertyDescriptor | undefined>();
function install(key: string, value: unknown) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, CSS: browser.CSS, localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) install(key, value);
// Happy DOM has no EventSource. This adapter consumes the real server's SSE stream;
// polling and dispatch remain entirely in the production hook.
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
// Unrelated navigation/Ketcher adapters are outside this operation; source, controller,
// all workers, HTTP session transport, and CLI are real.
mock.module("../apps/desktop/src/components/editor-area/page-kinds", () => ({ deserializeLocation: () => null, serializeLocation: () => null }));
mock.module("../apps/desktop/src/lib/ketcher-agent", () => ({ subscribeKetcherAgentRegistry: () => () => {} }));
const { createRoot } = await import("react-dom/client");
const { openScientificDocument } = await import("../apps/desktop/src/lib/workbench/generated-document-open");
const { useMoleculeStore } = await import("../apps/desktop/src/stores/molecule-store");
const { useAgentSession } = await import("../apps/desktop/src/hooks/use-agent-session");
const molden = `[Molden Format]\n[Atoms] AU\nH 1 1 0 0 0\n[GTO]\n1 0\ns 1 1.00\n1.0D+00 1.0\n[MO]\nSym= A\nEne= -0.5\nSpin= Alpha\nOccup= 0.25\n1 1.0\nSym= B\nEne= 0.25\nSpin= Beta\nOccup= 0.75\n1 -1.0\n`;
const repo = resolve(import.meta.dir, ".."), node = Bun.which("node")!;
const originalFetch = globalThis.fetch;
let root = "", session = "", baseUrl = "", token = "", draft: string | null = null;
let server: ReturnType<typeof spawn>, mounted: ReturnType<typeof createRoot>;
let documents: ViewerDocument[] = [], source: ViewerDocument, sourceText = "";
let propertyWorkers: Awaited<ReturnType<typeof builtPropertiesWorkers>>;
const hookErrors: unknown[] = [];
function Probe() {
  useAgentSession({ activeDocument: documents[0], documents, activeTabId: "tab", activeTabKind: "document", tabs: [],
    tabActions: { openNewTab() {}, setActiveTab() {}, closeTab() {}, moveTab() {} }, openDockingDocument: async () => null,
    openPaths() {}, openKetcherTab() {}, openTextDocuments: async () => null, pushErrorStatus(error) { hookErrors.push(error); }, setDockDocument() {},
    sourceDraftForDocument: () => draft }); return null;
}
async function render() { await act(async () => mounted.render(<Probe />)); }
function cli(request: Record<string, unknown>, extra: string[] = []) {
  return new Promise<{ status: number | null; body: any }>((done, reject) => {
    const child = spawn(node, [join(repo, "scripts/burette-agent.mjs"), "workbench", "--session-dir", session, JSON.stringify(request), "--wait-ms", "10000", ...extra], { cwd: repo });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", reject); child.on("close", status => { try { done({ status, body: JSON.parse(status === 0 ? stdout : stderr) }); } catch { reject(new Error(stdout + stderr)); } }); child.stdin.end();
  });
}
async function ok(request: Record<string, unknown>, extra: string[] = []) {
  const reply = await cli(request, extra); if (reply.status) throw new Error(JSON.stringify(reply.body)); expect(reply.status).toBe(0); return reply.body.result;
}
async function finished(jobId: string) {
  for (let i = 0; i < 50; i++) { const { job } = await ok({ operation: "status", jobId }); if (!["running", "queued"].includes(job.status)) return job; await Bun.sleep(10); }
  throw new Error("job did not finish");
}
const params = { field: "orbital", orbitalIndex: 1, spacingAngstrom: 0.5, paddingAngstrom: 1 };
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "burette-orbital-host-")); session = join(root, "session");
  propertyWorkers = await builtPropertiesWorkers(root, repo);
  await Promise.all([mkdir(session), mkdir(join(root, "dist"))]); await writeFile(join(root, "dist/index.html"), "<!doctype html><title>Agent fixture</title>");
  const listener = createServer(); await new Promise<void>(done => listener.listen(0, "127.0.0.1", done));
  const port = (listener.address() as { port: number }).port; await new Promise(done => listener.close(done));
  baseUrl = `http://127.0.0.1:${port}`; token = randomUUID();
  source = { id: "orbital-source", path: join(root, "h.xyz"), title: "h.xyz", extension: "xyz", renderer: "molstar", byteCount: molden.length, runtimePath: "viewer" };
  documents = [source];
  await openScientificDocument({ openStructureRecords: async records => {
    sourceText = records[0].text; await writeFile(source.path, sourceText);
    useMoleculeStore.setState({ documents }); return documents;
  } }, "h.molden", parseScientificFile("h.molden", molden), "final", { name: "h.molden", file: new Blob([molden]) });
  await writeFile(join(session, "session.json"), JSON.stringify({ apiVersion: "burette-agent-cli/v1", mode: "browser-dev-shell", token, createdAt: new Date().toISOString(), initialPaths: [source.path], allowedRoots: [root], sessionDir: session, host: "127.0.0.1", port, url: `${baseUrl}/?shellToken=${token}` }));
  await writeFile(join(session, "actions.json"), JSON.stringify({ apiVersion: "burette-agent-control/v1", actions: [] }));
  server = spawn(node, [join(repo, "scripts/agent-shell-server.mjs"), "--dist", join(root, "dist"), "--session-dir", session, "--allow", root, "--host", "127.0.0.1", "--port", String(port)], { cwd: repo, stdio: "ignore" });
  for (let i = 0; i < 100; i++) { if (await originalFetch(baseUrl + "/healthz").then(r => r.ok, () => false)) break; await Bun.sleep(25); }
  // Browser URL/cookie semantics adapted to Bun, without replacing any HTTP response.
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => originalFetch(typeof url === "string" ? new URL(url, baseUrl) : url,
    { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } })) as typeof fetch;
  mounted = createRoot(document.body.appendChild(document.createElement("div"))); await render();
  for (let i = 0; i < 100; i++) { if (await readFile(join(session, "observe.json")).then(() => true, () => false)) break; await Bun.sleep(10); }
});
afterAll(async () => {
  if (mounted) await act(async () => mounted.unmount()); await Bun.sleep(20);
  propertyWorkers?.restore(); server?.kill("SIGTERM"); releaseClosedImports(new Set()); globalThis.fetch = originalFetch;
  for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  if (root) await rm(root, { recursive: true, force: true });
});

test("compiled host and CLI produce signed orbital, total density and spin density Cube files with exact hashes and analytic values", async () => {
  const capabilities = await ok({ operation: "capabilities" });
  expect([capabilities.available, capabilities.draftsVisible, Object.keys(capabilities.jobs)]).toEqual([true, true, ["properties", "energy", "energy_forces", "frame_energy_forces", "optimize", "prepare_3d", "conformers", "metadata_edit", "pair_distribution", "orbital_cube", "insert_fragment", "hydrogens", "polymer", "smiles", "peptide"]]);
  const observed = await ok({ operation: "observe" });
  expect(observed.sourceTextSha256).toBe(`sha256-${createHash("sha256").update(sourceText).digest("hex")}`);
  const orbitals = await ok({ operation: "orbitals", limit: 1, offset: 1 });
  expect(orbitals.items).toEqual([{ index: 1, orbitalNumber: 1, energyHartree: 0.25, occupancy: 0.75, spin: "beta", symmetry: "B", coefficientCount: 1 }]);
  for (const field of ["orbital", "density", "spin-density"]) {
    const request = { operation: "submit", operationId: `analytic-${field}`, expectedSourceRevision: observed.sourceRevision, job: { kind: "orbital_cube", params: field === "orbital" ? params : { field, spacingAngstrom: 0.5, paddingAngstrom: 1 } } };
    const submitted = await ok(request), job = await finished(submitted.job.jobId);
    expect([job.status, job.binding, job.summary.dimensions, job.summary.pointCount]).toEqual(["succeeded", "current", [5,5,5], 125]);
    expect((await ok(request)).job.jobId).toBe(job.jobId);
    const path = join(root, `${field}.cube`), exported = await ok({ operation: "export", jobId: job.jobId, artifact: "cube" }, ["--output", path]);
    const bytes = await readFile(path); expect([bytes.length, `sha256-${createHash("sha256").update(bytes).digest("hex")}`]).toEqual([exported.artifact.byteCount, exported.artifact.sha256]);
    const reopened = parseScientificFile("result.cube", bytes.toString("utf8"));
    expect(reopened.atoms).toEqual([{ element: "H", x: 0, y: 0, z: 0 }]);
    const values = reopened.grid!.values, norm = (2 / Math.PI) ** 0.75, bohr = 0.529177210903; let index = 0;
    for (let x = -1; x <= 1; x += 0.5) for (let y = -1; y <= 1; y += 0.5) for (let z = -1; z <= 1; z += 0.5) {
      const amplitude = norm * Math.exp(-(x*x+y*y+z*z)/(bohr*bohr));
      const expected = field === "orbital" ? -amplitude : (field === "density" ? 1 : -0.5) * amplitude**2;
      expect(Math.abs(values[index++] - expected)).toBeLessThan(Math.max(1e-8, Math.abs(expected) * 2e-6));
    }
    expect(exported.artifact.content).toBeUndefined();
    const actionLog = JSON.parse(await readFile(join(session, "actions.json"), "utf8"));
    expect(actionLog.actions.some((item: any) => typeof item.result?.result?.artifact?.content === "string")).toBe(false);
    expect((await cli({ operation: "export", jobId: job.jobId, artifact: "cube" }, ["--output", path])).body.error.code).toBe("OUTPUT_EXISTS");
    await ok({ operation: "export", jobId: job.jobId, artifact: "cube" }, ["--output", path, "--overwrite"]);
    expect(await readFile(path)).toEqual(bytes);
  }
  expect(hookErrors).toEqual([]);
}, 30000);

test("same-text attached input changes invalidate old revision and retain the original export only with explicit allowStale", async () => {
  const attached = parseScientificFile("h.molden", molden); addDocumentInternalCoordinates(source.id, sourceText, attached);
  const old = await ok({ operation: "observe" });
  const { job: submitted } = await ok({ operation: "submit", operationId: "attached", expectedSourceRevision: old.sourceRevision, job: { kind: "orbital_cube", params } });
  expect((await finished(submitted.jobId)).status).toBe("succeeded");
  const originalExport = await ok({ operation: "export", jobId: submitted.jobId, artifact: "cube" }, ["--output", join(root, "attached-before.cube")]);
  const original = await readFile(originalExport.artifact.path);
  // Replacing and mutating basis/coefficients is the concrete old pointer/text-only binding failure.
  attached.orbitals[1].coefficients[0] = -0.5;
  const next = await ok({ operation: "observe" });
  expect(next.sourceTextSha256).toBe(old.sourceTextSha256); expect(next.sourceRevision).not.toBe(old.sourceRevision);
  expect((await ok({ operation: "status", jobId: submitted.jobId })).job.status).toBe("stale");
  expect((await cli({ operation: "submit", operationId: "old-binding", expectedSourceRevision: old.sourceRevision, job: { kind: "orbital_cube", params } })).body.error.code).toBe("REVISION_CONFLICT");
  expect((await cli({ operation: "export", jobId: submitted.jobId, artifact: "cube" })).body.error.code).toBe("STALE_RESULT");
  const exported = await ok({ operation: "export", jobId: submitted.jobId, artifact: "cube", allowStale: true });
  expect(await readFile(exported.artifact.path)).toEqual(original);
  draft = sourceText + "\n";
  expect((await ok({ operation: "observe" })).source.origin).toBe("draft");
  draft = null;
  documents = []; await render();
  const closed = (await ok({ operation: "status", jobId: submitted.jobId })).job;
  expect([closed.status, closed.binding, closed.artifacts, closed.summary]).toEqual(["source_closed", "source_closed", [], null]);
  expect((await cli({ operation: "export", jobId: submitted.jobId, artifact: "cube", allowStale: true })).body.error.code).toBe("SOURCE_CLOSED");
  documents = [source]; await render(); expect(hookErrors).toEqual([]);
}, 20000);

// These are already-open physical SDF documents, read by the production source
// owner over HTTP. This fixture does not claim the ordinary chooser boundary.
async function propertyDocument(fixture: typeof propertyCases[number]) {
  const path = join(root, `${fixture.name}.sdf`); await writeFile(path, fixture.source);
  const doc: ViewerDocument = { id: fixture.name, path, title: `${fixture.name}.sdf`, extension: "sdf", renderer: "molstar", byteCount: Buffer.byteLength(fixture.source), runtimePath: "viewer" };
  documents = [doc]; useMoleculeStore.setState({ documents }); await render(); return doc;
}

test("properties CLI and actual stdio MCP share the compiled host, exact SDF sources and frozen source-ordered Gasteiger values", async () => {
  const mcp = await mcpPropertiesClient(repo), original = importedOriginalFor(source.id), originalBytes = await original!.file.text();
  const call = async (action: Record<string, unknown>) => { const response = await mcp.control(session, action); expect(response.structuredContent.ok).toBe(true); return response.structuredContent.result.action.result.result; };
  try {
    for (const fixture of propertyCases) {
      const doc = await propertyDocument(fixture), observed = await call({ operation: "observe" });
      expect([observed.document.id, observed.source.origin, observed.sourceTextSha256]).toEqual([doc.id, "file", `sha256-${createHash("sha256").update(fixture.source).digest("hex")}`]);
      expect((await ok({ operation: "observe" })).sourceRevision).toBe(observed.sourceRevision);
      const request = { operation: "submit", operationId: `properties-${fixture.name}`, expectedSourceRevision: observed.sourceRevision, job: { kind: "properties", params: {} } };
      const submitted = await call(request), job = await finished(submitted.job.jobId);
      expect([job.status, job.binding, job.artifacts]).toEqual(["succeeded", "current", []]);
      expect(job.summary).toMatchObject({ formula: fixture.properties.formula, atomCount: fixture.properties.atomCount, bondCount: fixture.properties.bondCount, charge: 0 });
      expect(Math.abs(job.summary.molecularWeight - fixture.properties.molecularWeight)).toBeLessThan(0.01);
      expect(Math.abs(job.summary.exactMass - fixture.properties.exactMass)).toBeLessThan(1e-5);
      expect(job.summary.partialCharges).toBeUndefined();
      expect((await call({ operation: "status", jobId: job.jobId })).job.summary).toEqual(job.summary);
      expect((await call(request)).job.jobId).toBe(job.jobId);
      const conflict = await mcp.control(session, { ...request, job: { kind: "properties", params: { chargeModel: "Gasteiger" } } });
      expect(conflict.structuredContent.error.code).toBe("OPERATION_ID_CONFLICT");
      const count = JSON.parse(await readFile(join(session, "actions.json"), "utf8")).actions.length;
      const invalid = await mcp.control(session, { ...request, job: { kind: "properties", params: { unsupported: true } } });
      expect([invalid.isError, invalid.structuredContent.error.code]).toEqual([true, "INVALID_ARGS"]);
      expect(JSON.parse(await readFile(join(session, "actions.json"), "utf8")).actions).toHaveLength(count);
      const charged = await ok({ ...request, operationId: `charges-${fixture.name}`, job: { kind: "properties", params: { chargeModel: "Gasteiger" } } });
      const answer = await finished(charged.job.jobId);
      if ("charges" in fixture) {
        expect([answer.status, answer.binding, answer.summary.partialCharges.model, answer.summary.partialCharges.unit]).toEqual(["succeeded", "current", "Gasteiger", "e"]);
        const values = answer.summary.partialCharges.charges as number[]; expect(values).toHaveLength(fixture.elements.length);
        values.forEach((charge, index) => expect(Math.abs(charge - fixture.charges[index])).toBeLessThan(1e-7));
        expect(Math.abs(values.reduce((sum, value) => sum + value, 0))).toBeLessThan(1e-8);
      } else expect([answer.status, answer.summary, answer.artifacts]).toEqual(["failed", null, []]);
      expect((await cli({ ...request, operationId: `stale-${fixture.name}`, expectedSourceRevision: `sha256-${"a".repeat(64)}` })).body.error.code).toBe("REVISION_CONFLICT");
      draft = fixture.source + "\n";
      expect((await ok({ operation: "status", jobId: job.jobId })).job.status).toBe("stale"); draft = null;
      expect(await readFile(doc.path, "utf8")).toBe(fixture.source); expect(importedOriginalFor(doc.id)).toBeNull();
    }
    expect(importedOriginalFor(source.id)).toBe(original); expect(await original!.file.text()).toBe(originalBytes);
    for (const action of ["parse", "properties", "charges"]) expect(propertyWorkers.records.some(worker => worker.name === "compute-worker.ts" && worker.action === action)).toBe(true);
    expect(hookErrors).toEqual([]);
  } finally { mcp.close(); draft = null; documents = [source]; useMoleculeStore.setState({ documents }); await render(); }
}, 60000);

test("actual browser-bundled charge replies cannot publish after MCP cancel or same-id source close and reopen", async () => {
  const doc = await propertyDocument(propertyCases[1]);
  try {
    for (const closing of [false, true]) {
      const observed = await ok({ operation: "observe" }); propertyWorkers.hold("charges");
      const { job } = await ok({ operation: "submit", operationId: `held-properties-${closing}`, expectedSourceRevision: observed.sourceRevision, job: { kind: "properties", params: { chargeModel: "Gasteiger" } } });
      for (let attempt = 0; attempt < 300 && !propertyWorkers.pending.length; attempt++) await Bun.sleep(10);
      expect(propertyWorkers.pending.length).toBe(1);
      if (closing) { documents = []; useMoleculeStore.setState({ documents }); await render(); documents = [doc]; useMoleculeStore.setState({ documents }); await render(); }
      else {
        const mcp = await mcpPropertiesClient(repo);
        try { expect((await mcp.control(session, { operation: "cancel", jobId: job.jobId })).structuredContent.result.action.result.result.job.status).toBe("cancelled"); } finally { mcp.close(); }
      }
      propertyWorkers.release(); await Bun.sleep(20);
      const answer = (await ok({ operation: "status", jobId: job.jobId })).job;
      expect([answer.status, answer.summary, answer.artifacts]).toEqual([closing ? "source_closed" : "cancelled", null, []]);
      expect(propertyWorkers.records.filter(worker => worker.action === "charges").every(worker => worker.terminated)).toBe(true);
      expect(await readFile(doc.path, "utf8")).toBe(propertyCases[1].source); expect(importedOriginalFor(doc.id)).toBeNull();
    }
  } finally { propertyWorkers.release(); documents = [source]; useMoleculeStore.setState({ documents }); await render(); }
}, 30000);


async function energyDocument(fixture: typeof energyCases[number]) {
  const path = join(root, `${fixture.name}.${fixture.extension}`); await writeFile(path, fixture.source);
  const doc: ViewerDocument = { id: fixture.name, path, title: `${fixture.name}.${fixture.extension}`, extension: fixture.extension, renderer: "molstar", byteCount: Buffer.byteLength(fixture.source), runtimePath: "viewer" };
  documents = [doc]; useMoleculeStore.setState({ documents }); await render(); return doc;
}

test("energy and force CLI/MCP jobs retain independent model values, source order, artifact bytes and physical covariance", async () => {
  const original = importedOriginalFor(source.id), originalBytes = await original!.file.text(), mcp = await mcpPropertiesClient(repo);
  const submit = async (kind: string, forceField: string | undefined, id: string, viaMcp = false) => {
    const observed = await ok({ operation: "observe" });
    const request = { operation: "submit", operationId: id, expectedSourceRevision: observed.sourceRevision, job: { kind, params: forceField ? { forceField } : {} } };
    const result = viaMcp ? (await mcp.control(session, request)).structuredContent.result.action.result.result : await ok(request);
    const job = await finished(result.job.jobId); expect([job.status, job.binding]).toEqual(["succeeded", "current"]);
    expect((await ok(request)).job.jobId).toBe(job.jobId);
    expect((await cli({ ...request, job: { kind, params: { forceField: forceField === "UFF" ? "MMFF94" : "UFF" } } })).body.error.code).toBe("OPERATION_ID_CONFLICT");
    return job;
  };
  const forces = async (job: any, name: string) => {
    const path = join(root, `${name}.json`), exported = await ok({ operation: "export", jobId: job.jobId, artifact: "forces" }, ["--output", path]);
    const bytes = await readFile(path); expect([bytes.length, `sha256-${createHash("sha256").update(bytes).digest("hex")}`]).toEqual([exported.artifact.byteCount, exported.artifact.sha256]);
    expect(exported.artifact.content).toBeUndefined();
    expect((await cli({ operation: "export", jobId: job.jobId, artifact: "forces" }, ["--output", path])).body.error.code).toBe("OUTPUT_EXISTS");
    expect(await readFile(path)).toEqual(bytes);
    const result = JSON.parse(bytes.toString("utf8"));
    expect([result.forceField, result.unit, result.energyUnit, result.method]).toEqual([job.summary.forceField, "kcal/(mol·Å)", "kcal/mol", job.summary.forceField === "UFF" ? "analytic" : "central-difference"]);
    if (result.forceField === "UFF") expect(result.stepAngstrom).toBeUndefined(); else expect(result.stepAngstrom).toBe(1e-4);
    const norms = result.atoms.map((atom: any) => Math.hypot(...atom.force));
    expect([job.summary.atomCount, job.summary.energy, job.summary.energyUnit, job.summary.forceUnit]).toEqual([norms.length, result.energy, result.energyUnit, result.unit]);
    expect(job.summary.maxForce).toBeCloseTo(Math.max(...norms), 10); expect(job.summary.rmsForce).toBeCloseTo(Math.sqrt(norms.reduce((a: number, b: number) => a + b * b, 0) / norms.length), 10);
    return { result, bytes };
  };
  try {
    const amide = await energyDocument(energyCases[0]);
    for (const field of [undefined, "MMFF94", "MMFF94s", "UFF"]) {
      const job = await submit("energy", field, `amide-${field ?? "default"}`), model = field ?? "MMFF94";
      expect(job.artifacts).toEqual([]); expect([job.summary.forceField, job.summary.unit, job.summary.method]).toEqual([model, "kcal/mol", model === "UFF" ? "UFF (RDKit)" : `${model} (OpenChemLib)`]);
      expect(Math.abs(job.summary.energy - amideReference.energies[model])).toBeLessThan(1e-8);
    }
    expect(await readFile(amide.path, "utf8")).toBe(energyCases[0].source);
    const water = await energyDocument(energyCases[1]), waterJob = await submit("energy_forces", "UFF", "water-independent", true), artifact = await forces(waterJob, "water-independent");
    expect(Math.abs(artifact.result.energy - waterReference.expectedEnergyKcalMol)).toBeLessThan(1e-8);
    expect(artifact.result.atoms.map((atom: any) => [atom.index, atom.element])).toEqual([[0, "O"], [1, "H"], [2, "H"]]);
    artifact.result.atoms.flatMap((atom: any) => atom.force).forEach((value: number, i: number) => expect(Math.abs(value + waterReference.expectedGradientKcalMolAngstrom[i])).toBeLessThan(1e-7));
    draft = energyCases[1].source + "\n";
    expect((await cli({ operation: "export", jobId: waterJob.jobId, artifact: "forces" })).body.error.code).toBe("STALE_RESULT");
    const stale = await ok({ operation: "export", jobId: waterJob.jobId, artifact: "forces", allowStale: true }, ["--output", join(root, "water-stale.json")]);
    expect(await readFile(stale.artifact.path)).toEqual(artifact.bytes); draft = null;
    expect(await readFile(water.path, "utf8")).toBe(energyCases[1].source);
    for (const field of ["MMFF94", "MMFF94s", "UFF"]) {
      const answers: any[] = [];
      for (const fixture of energyCases.slice(2)) {
        const doc = await energyDocument(fixture), job = await submit("energy_forces", field, `${fixture.name}-${field}`), answer = (await forces(job, `${fixture.name}-${field}`)).result;
        expect(answer.atoms.map((atom: any) => atom.index)).toEqual([0, 1, 2]);
        expect(answer.atoms.map((atom: any) => atom.element)).toEqual(fixture.name.endsWith("permuted") ? ["O", "H", "H"] : ["H", "O", "H"]);
        expect(await readFile(doc.path, "utf8")).toBe(fixture.source); expect(importedOriginalFor(doc.id)).toBeNull(); answers.push(answer);
      }
      const [base, permuted, moved] = answers;
      for (const answer of [permuted, moved]) expect(Math.abs(answer.energy - base.energy)).toBeLessThan(1e-8);
      [1, 2, 0].forEach((sourceIndex, index) => base.atoms[sourceIndex].force.forEach((value: number, axis: number) => expect(Math.abs(value - permuted.atoms[index].force[axis])).toBeLessThan(1e-5)));
      base.atoms.forEach((atom: any, index: number) => [-atom.force[1], atom.force[0], atom.force[2]].forEach((value, axis) => expect(Math.abs(value - moved.atoms[index].force[axis])).toBeLessThan(1e-5)));
      for (let axis = 0; axis < 3; axis++) expect(Math.abs(base.atoms.reduce((sum: number, atom: any) => sum + atom.force[axis], 0))).toBeLessThan(0.002);
    }
    await propertyDocument(propertyCases[0]);
    for (const kind of ["energy", "energy_forces"]) {
      const observed = await ok({ operation: "observe" }), { job } = await ok({ operation: "submit", operationId: `implicit-energy-${kind}`, expectedSourceRevision: observed.sourceRevision, job: { kind, params: { forceField: "UFF" } } });
      expect(await finished(job.jobId)).toMatchObject({ status: "failed", summary: null, artifacts: [], error: { code: "JOB_FAILED" } });
      expect(await readFile(documents[0].path, "utf8")).toBe(propertyCases[0].source);
    }
    expect(importedOriginalFor(source.id)).toBe(original); expect(await original!.file.text()).toBe(originalBytes);
    expect(propertyWorkers.records.some(worker => worker.action === "energy")).toBe(true); expect(propertyWorkers.records.some(worker => worker.action === "energy-forces")).toBe(true);
    expect(hookErrors).toEqual([]);
  } finally { mcp.close(); draft = null; documents = [source]; useMoleculeStore.setState({ documents }); await render(); }
}, 90000);

test("held actual energy worker replies cannot publish after explicit cancel or same-id source close and reopen", async () => {
  const doc = await energyDocument(energyCases[2]);
  try {
    for (const kind of ["energy", "energy_forces"]) for (const closing of [false, true]) {
      const observed = await ok({ operation: "observe" }), action = kind === "energy" ? "energy" : "energy-forces"; propertyWorkers.hold(action);
      const { job } = await ok({ operation: "submit", operationId: `held-${kind}-${closing}`, expectedSourceRevision: observed.sourceRevision, job: { kind, params: { forceField: "UFF" } } });
      for (let attempt = 0; attempt < 300 && !propertyWorkers.pending.length; attempt++) await Bun.sleep(10);
      expect(propertyWorkers.pending.length).toBe(1);
      if (closing) { documents = []; useMoleculeStore.setState({ documents }); await render(); documents = [doc]; useMoleculeStore.setState({ documents }); await render(); }
      else expect((await ok({ operation: "cancel", jobId: job.jobId })).job.status).toBe("cancelled");
      propertyWorkers.release(); await Bun.sleep(20);
      const answer = (await ok({ operation: "status", jobId: job.jobId })).job;
      expect([answer.status, answer.summary, answer.artifacts]).toEqual([closing ? "source_closed" : "cancelled", null, []]);
      expect(propertyWorkers.records.filter(worker => worker.action === action).every(worker => worker.terminated)).toBe(true);
      expect(await readFile(doc.path, "utf8")).toBe(energyCases[2].source); expect(importedOriginalFor(doc.id)).toBeNull();
    }
  } finally { propertyWorkers.release(); documents = [source]; useMoleculeStore.setState({ documents }); await render(); }
}, 30000);

test("CLI errors, cancellation and permanent page close use the real compiled controller lifecycle", async () => {
  const actionCount = async () => JSON.parse(await readFile(join(session, "actions.json"), "utf8")).actions.length;
  const before = await actionCount();
  expect((await cli({ operation: "submit", operationId: "not-accepted", expectedSourceRevision: `sha256-${"a".repeat(64)}`, job: { kind: "point_group" } })).body.error.code).toBe("UNSUPPORTED_WORKBENCH_JOB");
  expect(await actionCount()).toBe(before);
  const observed = await ok({ operation: "observe" });
  const nativePost = Worker.prototype.postMessage, nativeTerminate = Worker.prototype.terminate;
  const held = new Set<Worker>(), terminated = new Set<Worker>();
  Worker.prototype.postMessage = function(this: Worker, message: unknown, options?: StructuredSerializeOptions) {
    if ((message as { type?: string }).type === "evaluate-field") { held.add(this); return; }
    nativePost.call(this, message, options);
  } as typeof nativePost;
  Worker.prototype.terminate = function() { terminated.add(this); return nativeTerminate.call(this); };
  try {
    const { job } = await ok({ operation: "submit", operationId: "cli-cancel", expectedSourceRevision: observed.sourceRevision, job: { kind: "orbital_cube", params } });
    expect((await ok({ operation: "cancel", jobId: job.jobId })).job.status).toBe("cancelled");
    expect(held.size).toBe(1); expect([...held].every(worker => terminated.has(worker))).toBe(true);
    expect((await cli({ operation: "export", jobId: job.jobId, artifact: "cube" })).body.error.code).toBe("JOB_NOT_SUCCEEDED");
  } finally { Worker.prototype.postMessage = nativePost; Worker.prototype.terminate = nativeTerminate; }
  const { job } = await ok({ operation: "submit", operationId: "cli-limits", expectedSourceRevision: observed.sourceRevision,
    job: { kind: "orbital_cube", params: { field: "density", spacingAngstrom: 0.05, paddingAngstrom: 10 } } });
  expect(await finished(job.jobId)).toMatchObject({ status: "failed", error: { code: "JOB_FAILED" }, artifacts: [] });
  browser.dispatchEvent(Object.assign(new browser.Event("pagehide"), { persisted: false }));
  expect((await cli({ operation: "observe" })).body.error.code).toBe("WORKBENCH_CLOSED");
  expect(hookErrors).toEqual([]);
}, 15000);
