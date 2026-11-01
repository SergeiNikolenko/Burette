import {
  WORKBENCH_AGENT_API_VERSION,
  WORKBENCH_LIMITS,
  WORKBENCH_RUNTIMES,
  validateWorkbenchRequest,
  workbenchContractSummary,
  type WorkbenchBuildJobRequest,
  type WorkbenchJobKind,
  type WorkbenchJobRequest,
  type WorkbenchRequest,
} from "../../../../../scripts/workbench-agent-contract.mjs";
import { runChemistryTask } from "../molecular-workbench/compute-client";
import { runGraphTask } from "../molecular-workbench/graph-compute-client";
import type { GraphEditResult } from "../molecular-workbench/graph-edit";
import { runFragmentTask } from "./fragment-task";
import { preparePolymerRequest, runPolymerTask } from "./polymer-task";
import { runPeptideTask } from "./peptide-task";
import { computeQuantumGrid } from "../molecular-workbench/quantum-client";
import { serializeCube } from "./cube-task";
import { fileStem } from "./formats";
import { createAgentSourceOwner, WorkbenchError, sha256, type Snapshot } from "./agent-source";
import type { ViewerDocument } from "../../types";
export { readWorkbenchAgentSource } from "./agent-source";

export type WorkbenchAgentRuntime = "browser-agent-shell" | "desktop-app" | "plugin-widget";
export type WorkbenchSourceRead = { text: string; origin: "draft" | "scene-source" | "file" };

export type WorkbenchAgentEnvironment = {
  runtime: WorkbenchAgentRuntime;
  documents: () => readonly ViewerDocument[];
  activeDocument: () => ViewerDocument | null | undefined;
  readSource: (document: ViewerDocument) => Promise<WorkbenchSourceRead>;
  /** Whether `readSource` returns unsaved editor drafts. */
  draftsVisible: boolean;
};

type Failure = { ok: false; command: "workbench"; error: { code: string; message: string; details?: unknown } };
type Success = { ok: true; command: "workbench"; result: Record<string, unknown> };
export type WorkbenchAgentResult = Success | Failure;

export type WorkbenchAgentController = {
  execute: (action: Record<string, unknown>) => Promise<WorkbenchAgentResult>;
  /** Cancels jobs and releases results of documents that are no longer open. */
  documentsChanged: (openDocumentIds: ReadonlySet<string>) => void;
  /**
   * Terminates every running worker, including source reads in progress, and drops
   * all jobs. Later calls fail with WORKBENCH_CLOSED; nothing runs after this.
   */
  dispose: () => void;
};

type DocumentRef = Pick<ViewerDocument, "id" | "path" | "title" | "extension" | "renderer">;
const COMMENT_LENGTH = 256;

type Artifact = { name: string; fileName: string; mimeType: string; content: string; byteCount: number; sha256: string };
type AnyJobRequest = WorkbenchJobRequest | WorkbenchBuildJobRequest;
const DOCUMENT_JOB_KINDS = ["properties", "energy", "energy_forces", "orbital_cube", "insert_fragment", "hydrogens", "polymer"] as const satisfies readonly WorkbenchJobKind[];
const GRAPH_EDIT_KINDS = new Set<WorkbenchJobKind>(["insert_fragment", "hydrogens", "polymer"]);

/** Hill-order formula of explicit atoms with the net formal charge of a V3000 table. */
function formulaOf(elements: readonly string[], molfile: string) {
  const counts = new Map<string, number>();
  for (const element of elements) counts.set(element, (counts.get(element) ?? 0) + 1);
  const order = [...counts.keys()].sort((a, b) => counts.has("C") && (a === "C" || b === "C") ? (a === "C" ? -1 : 1) : counts.has("C") && (a === "H" || b === "H") ? (a === "H" ? -1 : 1) : a.localeCompare(b));
  const charge = [...molfile.matchAll(/ CHG=(-?\d+)/gu)].reduce((sum, match) => sum + Number(match[1]), 0);
  return { formula: order.map(element => `${element}${counts.get(element)! > 1 ? counts.get(element) : ""}`).join(""), formalCharge: charge };
}
type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "source_closed";
type Job = {
  jobId: string;
  operationId: string;
  fingerprint: string;
  request: AnyJobRequest;
  /** Null for `build` jobs, which read no source document. */
  document: DocumentRef | null;
  sourceRevision: string | null;
  input: Snapshot | null;
  state: JobState;
  binding: "current" | "stale" | "source_closed" | "none";
  submittedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
  summary: Record<string, unknown> | null;
  artifacts: Artifact[];
  abort: AbortController | null;
};

const TERMINAL = new Set<JobState>(["succeeded", "failed", "cancelled", "source_closed"]);

function closedError() {
  return new WorkbenchError("WORKBENCH_CLOSED", "The workspace closed; workbench jobs and reads were stopped.");
}

function failure(code: string, message: string, details?: unknown): Failure {
  return { ok: false, command: "workbench", error: details === undefined ? { code, message } : { code, message, details } };
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

const encoder = new TextEncoder();
function byteLength(text: string) {
  return encoder.encode(text).length;
}

function bounded(text: string | undefined, limit = COMMENT_LENGTH) {
  return typeof text === "string" ? text.slice(0, limit) : null;
}

function page<T>(items: readonly T[], offset: number, limit: number, map: (item: T, index: number) => unknown) {
  const slice = items.slice(offset, offset + limit);
  const end = offset + slice.length;
  return { total: items.length, offset, limit, returned: slice.length, nextOffset: end < items.length ? end : null, items: slice.map((item, index) => map(item, offset + index)) };
}

function documentRef(document: ViewerDocument): DocumentRef {
  return { id: document.id, path: document.path, title: document.title, extension: document.extension, renderer: document.renderer };
}

export function createWorkbenchAgentController(environment: WorkbenchAgentEnvironment): WorkbenchAgentController {
  const jobs = new Map<string, Job>();
  const operations = new Map<string, string>();
  // Workspace guard; dispose also aborts each document's parsing workers.
  const lifetime = new AbortController();

  const enabled = (WORKBENCH_RUNTIMES as readonly string[]).includes(environment.runtime);

  function limitations() {
    const notes = [
      "Results are never applied to an open document. Export an artifact and open it explicitly.",
      "Structure jobs (insert_fragment, hydrogens, polymer and the build kinds) write new structure artifacts; they never edit the open document or its Undo history.",
      "Workbench UI commands that are not listed under jobs (atom/bond editing, input-deck export, Z-matrix editing, crystal symmetry, spectra and plots) are not automated.",
    ];
    if (!environment.draftsVisible) notes.unshift("Unsaved editor drafts are not visible to this session; reads and jobs use the saved source.");
    if (!enabled) notes.unshift(`Workbench reads and jobs run only in ${WORKBENCH_RUNTIMES.join(", ")} sessions; this session is ${environment.runtime}.`);
    return notes;
  }

  const sourceOwner = createAgentSourceOwner(environment, lifetime.signal);
  const { snapshotOf, assertOpen } = sourceOwner;

  function jobUnavailable(snapshot: Snapshot, kind: WorkbenchJobKind): string | null {
    if (GRAPH_EDIT_KINDS.has(kind)) {
      if (!["sdf", "sd", "mol"].includes(snapshot.extension) || !snapshot.structure) return snapshot.structureError ?? "This job requires one explicit MOL or SDF connection table.";
      return snapshot.structure.graphSource === "explicit" && snapshot.structure.graphComplete ? null : "This job requires one explicit MOL or SDF connection table.";
    }
    if (kind === "properties" || kind === "energy" || kind === "energy_forces") {
      if (!snapshot.structure) return snapshot.structureError ?? snapshot.sourceError ?? "The chemical graph could not be read.";
      if (!snapshot.structure.graphComplete) return "This source has no complete bond orders or charges. Open an SDF or MOL version of the structure.";
      return kind === "energy_forces" && snapshot.structure.atoms.length > 64 ? "Forces support at most 64 atoms." : null;
    }
    if (!snapshot.scientific?.basis?.length) return "This source has no Gaussian basis set (open an FCHK or Molden file).";
    return snapshot.scientific.orbitals.length ? null : "This source has no molecular orbitals.";
  }

  function paramsUnavailable(snapshot: Snapshot, job: WorkbenchJobRequest): string | null {
    const atoms = snapshot.structure?.atoms.length ?? 0;
    if (job.kind === "insert_fragment" && job.params.atomIndex !== undefined && job.params.atomIndex >= atoms) return `atomIndex must be below ${atoms}.`;
    if (job.kind === "polymer" && [job.params.head, job.params.tail, job.params.headLeaving, job.params.tailLeaving].some(index => index >= atoms)) return `Polymer atom indices must be below ${atoms}.`;
    if (job.kind === "orbital_cube" && job.params.field === "orbital" && job.params.orbitalIndex! >= snapshot.scientific!.orbitals.length) {
      return `orbitalIndex must be below ${snapshot.scientific!.orbitals.length}.`;
    }
    return null;
  }

  async function read(request: Extract<WorkbenchRequest, { operation: "observe" | "orbitals" }>) {
    const snapshot = await snapshotOf(request);
    const base = { documentId: snapshot.document.id, sourceRevision: snapshot.revision, sourceTextSha256: snapshot.sourceTextSha256 };
    if (request.operation === "observe") {
      const jobs = Object.fromEntries(DOCUMENT_JOB_KINDS.map(kind => {
        const reason = jobUnavailable(snapshot, kind);
        return [kind, reason ? { available: false, reason } : { available: true }];
      }));
      return { ...base, document: { ...documentRef(snapshot.document), active: environment.activeDocument()?.id === snapshot.document.id },
        source: { origin: snapshot.origin, byteCount: snapshot.byteCount, draftsVisible: environment.draftsVisible },
        scientific: snapshot.scientific ? { origin: snapshot.scientificOrigin, format: snapshot.scientific.format,
          atomCount: snapshot.scientific.atoms.length, orbitalCount: snapshot.scientific.orbitals.length,
          basisShellCount: snapshot.scientific.basis?.length ?? 0 } : null,
        sourceError: snapshot.sourceError,
        jobs };
    }
    return { ...base, ...page(snapshot.scientific?.orbitals ?? [], request.offset, request.limit, (orbital, index) => ({
      index, orbitalNumber: orbital.index, energyHartree: orbital.energyHartree, occupancy: orbital.occupancy,
      spin: orbital.spin, symmetry: bounded(orbital.symmetry, 32), coefficientCount: orbital.coefficients.length,
    })) };
  }

  // Jobs ------------------------------------------------------------------

  function publicJob(job: Job) {
    const status = job.state === "succeeded" && job.binding === "stale" ? "stale" : job.state;
    return {
      jobId: job.jobId,
      operationId: job.operationId,
      kind: job.request.kind,
      params: job.request.params,
      documentId: job.document?.id ?? null,
      documentTitle: job.document?.title.slice(0, COMMENT_LENGTH) ?? null,
      sourceRevision: job.sourceRevision,
      sourceTextSha256: job.input?.sourceTextSha256 ?? null,
      status,
      binding: job.binding,
      submittedAt: job.submittedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      summary: job.summary,
      artifacts: job.artifacts.map(({ name, fileName, mimeType, byteCount, sha256 }) => ({ name, fileName, mimeType, byteCount, sha256 })),
    };
  }

  function findJob(jobId: string) {
    const job = jobs.get(jobId);
    if (!job) throw new WorkbenchError("JOB_NOT_FOUND", `Job ${jobId} is not known to this workspace. Finished jobs are retained up to ${WORKBENCH_LIMITS.retainedJobs}.`, { jobId });
    return job;
  }

  /**
   * Releases a job whose document closed. Running and finished jobs become
   * `source_closed` and drop their results; failures and cancellations keep their outcome.
   */
  function closeJob(job: Job) {
    job.abort?.abort();
    job.abort = null;
    if (job.state !== "failed" && job.state !== "cancelled") {
      job.state = "source_closed";
      job.error = { code: "SOURCE_CLOSED", message: "The source document was closed." };
    }
    job.binding = "source_closed";
    job.artifacts = [];
    job.summary = null;
    job.finishedAt ??= new Date().toISOString();
  }

  /** Re-reads the job's document and records whether its source is still the job's input. */
  async function refreshBinding(job: Job) {
    if (job.binding === "source_closed" || !job.document || !job.input) return;
    const jobDocument = job.document, input = job.input;
    const document = environment.documents().find((item) => item.id === jobDocument.id);
    if (!document) {
      closeJob(job);
      return;
    }
    try {
      assertOpen(document, input.lifetime);
      const { revision } = await snapshotOf({ documentId: document.id });
      assertOpen(document, input.lifetime);
      job.binding = revision === job.sourceRevision ? "current" : "stale";
    } catch (error) {
      if (error instanceof WorkbenchError && error.code === "SOURCE_CLOSED") closeJob(job);
      else if (!input.lifetime.abort.signal.aborted) job.binding = "stale";
    }
  }

  function retain() {
    const terminal = [...jobs.values()].filter((job) => TERMINAL.has(job.state));
    for (const job of terminal.slice(0, Math.max(0, terminal.length - WORKBENCH_LIMITS.retainedJobs))) {
      jobs.delete(job.jobId);
      if (operations.get(job.operationId) === job.jobId) operations.delete(job.operationId);
    }
  }

  async function artifact(name: string, fileName: string, mimeType: string, content: string): Promise<Artifact> {
    const byteCount = byteLength(content);
    if (byteCount > WORKBENCH_LIMITS.artifactBytes) throw new WorkbenchError("ARTIFACT_TOO_LARGE", `The ${name} artifact is ${byteCount} bytes; the limit is ${WORKBENCH_LIMITS.artifactBytes}.`);
    return { name, fileName, mimeType, content, byteCount, sha256: `sha256-${await sha256(content)}` };
  }

  /** A structure artifact: the edited V3000 table under the source title, as an SDF record or bare MOL. */
  async function structureArtifact(input: Snapshot, suffix: string, molfile: string) {
    const stem = fileStem(input.document.title), mol = input.extension === "mol", lines = molfile.replace(/\s+$/u, "").split("\n");
    lines[0] = stem.slice(0, 80);
    return artifact("structure", `${stem}-${suffix}.${mol ? "mol" : "sdf"}`, mol ? "chemical/x-mdl-molfile" : "chemical/x-mdl-sdfile", `${lines.join("\n")}\n${mol ? "" : "$$$$\n"}`);
  }

  function graphSummary(structure: GraphEditResult, source: number) {
    return { atomCount: structure.atoms.length, bondCount: structure.bonds.length, ...formulaOf(structure.atoms.map(atom => atom.element), structure.molfile),
      sourceAtomCount: source, sourceAtomIndices: structure.sourceAtomIndices };
  }

  async function runBuild(request: WorkbenchBuildJobRequest, options: { signal: AbortSignal; timeoutMs: number }) {
    const { params } = request;
    const result = await runPeptideTask({ sequence: params.sequence, codes: params.codes, options: { chirality: params.chirality, phi: params.phiDegrees, psi: params.psiDegrees, nTerminus: params.nTerminus, cTerminus: params.cTerminus, chain: params.chain } }, options);
    return { summary: { sequence: result.sequence, residueCount: result.residueCount, atomCount: result.atomCount, formalCharge: result.charge },
      artifacts: [await artifact("structure", `Peptide ${result.sequence.slice(0, 32)}.cif`, "chemical/x-mmcif", result.cif)] };
  }

  async function runGraphEdit(input: Snapshot, request: Extract<WorkbenchJobRequest, { kind: "insert_fragment" | "hydrogens" | "polymer" }>, options: { signal: AbortSignal; timeoutMs: number }) {
    const structure = input.structure!;
    if (request.kind === "insert_fragment") {
      const { library, smiles, atomIndex } = request.params;
      const inserted = await runFragmentTask({ molecule: structure, fragment: library !== undefined ? { source: "library", id: library } : { source: "smiles", smiles: smiles! }, target: atomIndex ?? null }, options);
      return { summary: { ...graphSummary(inserted.structure, structure.atoms.length), fragment: inserted.name.slice(0, 128), addedAtoms: inserted.addedAtoms, anchorAtom: inserted.anchor, replacedAtom: inserted.replaced, bondLengthAngstrom: inserted.bondLength },
        artifacts: [await structureArtifact(input, "fragment", inserted.structure.molfile)] };
    }
    if (request.kind === "hydrogens") {
      const hydrogens = structure.atoms.flatMap((atom, index) => atom.element === "H" ? [index] : []);
      const edited = request.params.mode === "remove"
        ? hydrogens.length ? await runGraphTask({ action: "edit-graph", molecule: structure, edits: [{ kind: "delete-atoms", indices: hydrogens }] }, options)
          : await runGraphTask({ action: "edit-graph", molecule: structure, edits: [{ kind: "reorder-atoms", order: structure.atoms.map((_, i) => i) }] }, options)
        : await runChemistryTask({ action: "add-hydrogens", molecule: structure }, options).then(added => runGraphTask({ action: "edit-graph", molecule: added, edits: [{ kind: "reorder-atoms", order: added.atoms.map((_, i) => i) }] }, options))
          .then(added => ({ ...added, sourceAtomIndices: added.sourceAtomIndices.map(index => index < structure.atoms.length ? index : -1) }));
      return { summary: { ...graphSummary(edited, structure.atoms.length), mode: request.params.mode, changedAtoms: Math.abs(edited.atoms.length - structure.atoms.length) },
        artifacts: [await structureArtifact(input, request.params.mode === "add" ? "with-h" : "no-h", edited.molfile)] };
    }
    const { head, tail, headLeaving, tailLeaving, count, bondLengthAngstrom, tacticity, headEnd, tailEnd, relax } = request.params;
    const polymer = await runPolymerTask(preparePolymerRequest({ text: input.text, format: input.extension === "mol" ? "mol" : "sdf" },
      { head, tail, headLeaving, tailLeaving, count, bondLength: bondLengthAngstrom, endGroups: "hydrogen", tacticity, ends: { head: headEnd, tail: tailEnd }, relax }), options);
    return { summary: { atomCount: polymer.atomCount, bondCount: polymer.bondCount, repeatCount: count, repeatAlternatives: polymer.repeatAlternatives, relaxation: polymer.relaxation ?? null },
      artifacts: [await artifact("structure", `${fileStem(input.document.title)}-polymer-${count}.sdf`, "chemical/x-mdl-sdfile", polymer.sdf)] };
  }

  async function runJob(job: Job, signal: AbortSignal): Promise<{ summary: Record<string, unknown>; artifacts: Artifact[] }> {
    const options = { signal, timeoutMs: WORKBENCH_LIMITS.jobTimeoutMs };
    if (job.request.kind === "peptide") return runBuild(job.request, options);
    const input = job.input!, request = job.request as WorkbenchJobRequest;
    if (request.kind === "insert_fragment" || request.kind === "hydrogens" || request.kind === "polymer") return runGraphEdit(input, request, options);
    if (request.kind === "properties") {
      const deadline = performance.now() + options.timeoutMs;
      const properties = await runChemistryTask({ action: "properties", molecule: input.structure! }, options);
      const remainingMs = deadline - performance.now();
      if (request.params.chargeModel && remainingMs <= 0) throw new Error("Calculation exceeded the browser time limit.");
      const partialCharges = request.params.chargeModel === "Gasteiger"
        ? await runChemistryTask({ action: "charges", molecule: input.structure! }, { ...options, timeoutMs: remainingMs }) : undefined;
      return { summary: { method: "OpenChemLib", ...properties, ...(partialCharges ? { partialCharges } : {}) }, artifacts: [] };
    }
    const stem = fileStem(input.document.title);
    if (request.kind === "energy") {
      return { summary: { method: request.params.forceField === "UFF" ? "UFF (RDKit)" : `${request.params.forceField} (OpenChemLib)`, forceField: request.params.forceField, energy: await runChemistryTask({ action: "energy", molecule: input.structure!, forceField: request.params.forceField }, options), unit: "kcal/mol" }, artifacts: [] };
    }
    if (request.kind === "energy_forces") {
      const result = await runChemistryTask({ action: "energy-forces", molecule: input.structure!, forceField: request.params.forceField }, options);
      const magnitudes = result.forces.map((force) => Math.hypot(...force));
      const forces = JSON.stringify({ forceField: request.params.forceField, unit: result.forceUnit, energy: result.energy, energyUnit: result.energyUnit, method: result.method, stepAngstrom: result.stepAngstrom, atoms: input.structure!.atoms.map((atom, index) => ({ index, element: atom.element, force: result.forces[index] })) }, null, 1);
      return {
        summary: { method: request.params.forceField === "UFF" ? "UFF (RDKit), analytic" : `${request.params.forceField} (OpenChemLib), central difference`, forceField: request.params.forceField, energy: result.energy, energyUnit: result.energyUnit, forceUnit: result.forceUnit, maxForce: Math.max(...magnitudes), rmsForce: Math.sqrt(magnitudes.reduce((sum, value) => sum + value * value, 0) / magnitudes.length), atomCount: magnitudes.length },
        artifacts: [await artifact("forces", `${stem}-forces.json`, "application/json", `${forces}\n`)],
      };
    }
    const { field, orbitalIndex, spacingAngstrom, paddingAngstrom } = request.params;
    const scientific = input.scientific!;
    const grid = await computeQuantumGrid(scientific, field === "orbital" ? { kind: "orbital", orbitalIndex: orbitalIndex! } : { kind: field }, { spacingAngstrom, paddingAngstrom }, signal);
    let min = Infinity;
    let max = -Infinity;
    for (const value of grid.values) { if (value < min) min = value; if (value > max) max = value; }
    const cube = await serializeCube(grid, scientific.atoms, options);
    const label = field === "orbital" ? `orbital-${orbitalIndex}` : field;
    return {
      summary: { field, orbitalIndex: orbitalIndex ?? null, dimensions: grid.dimensions, pointCount: grid.values.length, min, max },
      artifacts: [await artifact("cube", `${stem}-${label}.cube`, "chemical/x-cube", cube)],
    };
  }

  async function start(job: Job) {
    const abort = new AbortController();
    job.abort = abort;
    job.state = "running";
    job.startedAt = new Date().toISOString();
    try {
      const { summary, artifacts } = await runJob(job, abort.signal);
      if (abort.signal.aborted || job.state !== "running" || lifetime.signal.aborted) return;
      // Publish a terminal result only after binding refresh, with retention in
      // the same turn. Cancellation or source closure during the read wins.
      await refreshBinding(job);
      if (abort.signal.aborted || job.state !== "running" || lifetime.signal.aborted) return;
      job.summary = summary;
      job.artifacts = artifacts;
      job.state = "succeeded";
    } catch (error) {
      if (job.state !== "running") return;
      if (abort.signal.aborted || (error instanceof Error && error.name === "AbortError")) job.state = "cancelled";
      else {
        job.state = "failed";
        job.error = error instanceof WorkbenchError ? { code: error.code, message: error.message } : { code: "JOB_FAILED", message: errorMessage(error) };
      }
    } finally {
      if (job.abort === abort) job.abort = null;
      job.finishedAt ??= new Date().toISOString();
      if (!lifetime.signal.aborted) {
        retain();
        pump();
      }
    }
  }

  function pump() {
    if (lifetime.signal.aborted) return;
    const all = [...jobs.values()];
    let running = all.filter((job) => job.state === "running").length;
    for (const job of all) {
      if (running >= WORKBENCH_LIMITS.activeJobs) break;
      if (job.state !== "queued") continue;
      running += 1;
      void start(job);
    }
  }

  async function submit(request: Extract<WorkbenchRequest, { operation: "submit" }>) {
    if (!enabled) throw new WorkbenchError("SURFACE_UNSUPPORTED", limitations()[0]);
    const fingerprint = JSON.stringify([request.documentId ?? null, request.expectedSourceRevision, request.job]);
    const existingId = operations.get(request.operationId);
    const existing = existingId ? jobs.get(existingId) : undefined;
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new WorkbenchError("OPERATION_ID_CONFLICT", `operationId ${request.operationId} was already used for a different request (job ${existing.jobId}).`, { operationId: request.operationId, jobId: existing.jobId });
      }
      return { deduplicated: true, job: publicJob(existing) };
    }
    const snapshot = await snapshotOf(request);
    assertOpen(snapshot.document, snapshot.lifetime);
    const reason = jobUnavailable(snapshot, request.job.kind) ?? paramsUnavailable(snapshot, request.job);
    if (reason) throw new WorkbenchError("JOB_UNAVAILABLE", `${request.job.kind} cannot run on ${snapshot.document.title}: ${reason}`, { kind: request.job.kind, documentId: snapshot.document.id });
    const pending = [...jobs.values()].filter((job) => job.state === "queued").length;
    if (pending >= WORKBENCH_LIMITS.queuedJobs) throw new WorkbenchError("JOB_QUEUE_FULL", `${pending} workbench jobs are already queued. Wait for one to finish or cancel one.`);
    const job: Job = {
      jobId: `wbj-${crypto.randomUUID().replace(/-/gu, "").slice(0, 16)}`,
      operationId: request.operationId,
      fingerprint,
      request: request.job,
      document: documentRef(snapshot.document),
      sourceRevision: snapshot.revision,
      input: snapshot,
      state: "queued",
      binding: "current",
      submittedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      error: null,
      summary: null,
      artifacts: [],
      abort: null,
    };
    jobs.set(job.jobId, job);
    operations.set(job.operationId, job.jobId);
    pump();
    return { deduplicated: false, job: publicJob(job) };
  }

  /** A documentless build shares the job queue, deduplication, cancellation and export of `submit`. */
  function build(request: Extract<WorkbenchRequest, { operation: "build" }>) {
    if (!enabled) throw new WorkbenchError("SURFACE_UNSUPPORTED", limitations()[0]);
    const fingerprint = JSON.stringify(["build", request.job]);
    const existing = jobs.get(operations.get(request.operationId) ?? "");
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new WorkbenchError("OPERATION_ID_CONFLICT", `operationId ${request.operationId} was already used for a different request (job ${existing.jobId}).`, { operationId: request.operationId, jobId: existing.jobId });
      return { deduplicated: true, job: publicJob(existing) };
    }
    const pending = [...jobs.values()].filter((job) => job.state === "queued").length;
    if (pending >= WORKBENCH_LIMITS.queuedJobs) throw new WorkbenchError("JOB_QUEUE_FULL", `${pending} workbench jobs are already queued. Wait for one to finish or cancel one.`);
    const job: Job = { jobId: `wbj-${crypto.randomUUID().replace(/-/gu, "").slice(0, 16)}`, operationId: request.operationId, fingerprint, request: request.job,
      document: null, sourceRevision: null, input: null, state: "queued", binding: "none", submittedAt: new Date().toISOString(), startedAt: null, finishedAt: null,
      error: null, summary: null, artifacts: [], abort: null };
    jobs.set(job.jobId, job);
    operations.set(job.operationId, job.jobId);
    pump();
    return { deduplicated: false, job: publicJob(job) };
  }

  async function status(request: Extract<WorkbenchRequest, { operation: "status" }>) {
    const jobId = request.jobId ?? operations.get(request.operationId!);
    if (!jobId) throw new WorkbenchError("JOB_NOT_FOUND", `No job was submitted with operationId ${request.operationId}.`, { operationId: request.operationId });
    const job = findJob(jobId);
    await refreshBinding(job);
    return { job: publicJob(job) };
  }

  function cancel(jobId: string) {
    const job = findJob(jobId);
    if (TERMINAL.has(job.state)) return { cancelled: false, job: publicJob(job) };
    job.abort?.abort();
    job.abort = null;
    job.state = "cancelled";
    job.finishedAt = new Date().toISOString();
    retain();
    pump();
    return { cancelled: true, job: publicJob(job) };
  }

  async function exportArtifact(request: Extract<WorkbenchRequest, { operation: "export" }>) {
    const job = findJob(request.jobId);
    await refreshBinding(job);
    if (job.binding === "source_closed") throw new WorkbenchError("SOURCE_CLOSED", `The source document of job ${job.jobId} was closed; its results were released.`, { job: publicJob(job) });
    if (job.state !== "succeeded") throw new WorkbenchError("JOB_NOT_SUCCEEDED", `Job ${job.jobId} is ${job.state}; only succeeded jobs have artifacts.`, { job: publicJob(job) });
    if (job.binding === "stale" && !request.allowStale) {
      throw new WorkbenchError("STALE_RESULT", `The source of ${job.document?.title} changed after job ${job.jobId} was submitted. Pass allowStale: true to export a result of the earlier revision ${job.sourceRevision}.`, { job: publicJob(job) });
    }
    const found = job.artifacts.find((item) => item.name === request.artifact);
    if (!found) throw new WorkbenchError("ARTIFACT_NOT_FOUND", `Job ${job.jobId} has no ${request.artifact} artifact.`, { artifacts: job.artifacts.map((item) => item.name) });
    // The content is the artifact transport: the CLI writes it to a file and drops it from the action log.
    return {
      jobId: job.jobId,
      sourceRevision: job.sourceRevision,
      sourceTextSha256: job.input?.sourceTextSha256 ?? null,
      binding: job.binding,
      artifact: { name: found.name, fileName: found.fileName, mimeType: found.mimeType, byteCount: found.byteCount, sha256: found.sha256, encoding: "utf8", content: found.content },
    };
  }

  function capabilities() {
    return {
      ...workbenchContractSummary(),
      runtime: environment.runtime,
      available: enabled,
      draftsVisible: environment.draftsVisible,
      limitations: limitations(),
    };
  }

  async function dispatch(request: WorkbenchRequest): Promise<Record<string, unknown>> {
    if (request.operation === "capabilities") return capabilities();
    if (!enabled) throw new WorkbenchError("SURFACE_UNSUPPORTED", limitations()[0], { runtime: environment.runtime });
    switch (request.operation) {
      case "submit":
        return submit(request);
      case "build":
        return build(request);
      case "status":
        return status(request);
      case "jobs":
        return page([...jobs.values()].reverse(), request.offset, request.limit, (job) => publicJob(job));
      case "cancel":
        return cancel(request.jobId);
      case "export":
        return exportArtifact(request);
      default:
        return read(request);
    }
  }

  return {
    async execute(action) {
      if (lifetime.signal.aborted) return failure("WORKBENCH_CLOSED", closedError().message);
      const validated = validateWorkbenchRequest(action);
      if (!validated.ok) return failure(validated.error.code, validated.error.message, validated.error.details ?? undefined);
      const { request } = validated;
      try {
        const result = { apiVersion: WORKBENCH_AGENT_API_VERSION, operation: request.operation, ...await dispatch(request) };
        if (request.operation !== "export" && byteLength(JSON.stringify(result)) > WORKBENCH_LIMITS.responseBytes) {
          return failure("RESPONSE_TOO_LARGE", `The ${request.operation} response exceeds ${WORKBENCH_LIMITS.responseBytes} bytes. Request a smaller page (limit).`);
        }
        return { ok: true, command: "workbench", result };
      } catch (error) {
        if (error instanceof WorkbenchError) return failure(error.code, error.message, error.details);
        return failure("WORKBENCH_FAILED", errorMessage(error));
      }
    },
    documentsChanged(openDocumentIds) {
      if (lifetime.signal.aborted) return;
      sourceOwner.documentsChanged(openDocumentIds);
      for (const job of jobs.values()) {
        if (job.document && !openDocumentIds.has(job.document.id) && job.binding !== "source_closed") closeJob(job);
      }
      retain();
      pump();
    },
    dispose() {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      sourceOwner.dispose();
      for (const job of jobs.values()) {
        job.abort?.abort();
        job.abort = null;
        if (!TERMINAL.has(job.state)) job.state = "cancelled";
      }
      jobs.clear();
      operations.clear();
    },
  };
}
