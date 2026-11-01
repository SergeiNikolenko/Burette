import {
  WORKBENCH_AGENT_API_VERSION,
  WORKBENCH_LIMITS,
  WORKBENCH_RUNTIMES,
  validateWorkbenchRequest,
  workbenchContractSummary,
  type WorkbenchJobKind,
  type WorkbenchJobParams,
  type WorkbenchJobRequest,
  type WorkbenchRequest,
} from "../../../../../scripts/workbench-agent-contract.mjs";
import { fileStem } from "./formats";
import { createAgentSourceOwner, WorkbenchError, sha256, type Snapshot } from "./agent-source";
import { AGENT_JOBS, type AgentArtifact, type AgentJobRunner } from "./agent-jobs";
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

type Artifact = AgentArtifact;
type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "source_closed";
type Job = {
  jobId: string;
  operationId: string;
  fingerprint: string;
  request: WorkbenchJobRequest;
  document: DocumentRef;
  sourceRevision: string;
  input: Snapshot;
  state: JobState;
  binding: "current" | "stale" | "source_closed";
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
      "Workbench UI commands that are not listed under jobs (builders, graph and hydrogen edits, input-deck export, Z-matrix editing, spectra and plots) are not automated yet.",
    ];
    if (!environment.draftsVisible) notes.unshift("Unsaved editor drafts are not visible to this session; reads and jobs use the saved source.");
    if (!enabled) notes.unshift(`Workbench reads and jobs run only in ${WORKBENCH_RUNTIMES.join(", ")} sessions; this session is ${environment.runtime}.`);
    return notes;
  }

  const sourceOwner = createAgentSourceOwner(environment, lifetime.signal);
  const { snapshotOf, assertOpen } = sourceOwner;

  const runner = <K extends WorkbenchJobKind>(kind: K) => AGENT_JOBS[kind] as AgentJobRunner<K>;
  function jobUnavailable(snapshot: Snapshot, job: WorkbenchJobRequest): string | null {
    const definition = runner(job.kind);
    return definition.unavailable(snapshot) ?? definition.paramsUnavailable?.(snapshot, job.params as WorkbenchJobParams<typeof job.kind>) ?? null;
  }

  async function read(request: Extract<WorkbenchRequest, { operation: "observe" | "atoms" | "orbitals" }>) {
    const snapshot = await snapshotOf(request);
    const base = { documentId: snapshot.document.id, sourceRevision: snapshot.revision, sourceTextSha256: snapshot.sourceTextSha256 };
    if (request.operation === "observe") {
      const jobs = Object.fromEntries((Object.keys(AGENT_JOBS) as WorkbenchJobKind[]).map(kind => {
        const reason = runner(kind).unavailable(snapshot);
        return [kind, reason ? { available: false, reason } : { available: true }];
      }));
      return { ...base, document: { ...documentRef(snapshot.document), active: environment.activeDocument()?.id === snapshot.document.id },
        source: { origin: snapshot.origin, byteCount: snapshot.byteCount, draftsVisible: environment.draftsVisible },
        structure: snapshot.structure ? { atomCount: snapshot.structure.atoms.length, bondCount: snapshot.structure.bonds.length,
          graph: snapshot.structure.graphSource, graphComplete: snapshot.structure.graphComplete } : null,
        frames: { count: snapshot.sdfRecords || Math.max(snapshot.scientific?.frames.length ?? 0, snapshot.source ? 1 : 0), source: snapshot.sdfRecords ? "sdf-records" : "frames" },
        scientific: snapshot.scientific ? { origin: snapshot.scientificOrigin, format: snapshot.scientific.format,
          atomCount: snapshot.scientific.atoms.length, orbitalCount: snapshot.scientific.orbitals.length,
          basisShellCount: snapshot.scientific.basis?.length ?? 0 } : null,
        sourceError: snapshot.sourceError,
        crystal: snapshot.crystal ? { format: snapshot.crystalSource!.format, atomCount: snapshot.crystal.atoms.length, cell: snapshot.crystal.cell } : null,
        jobs };
    }
    if (request.operation === "atoms") {
      const frames = snapshot.scientific?.frames ?? [];
      if (request.frameIndex !== undefined && request.frameIndex >= Math.max(frames.length, 1)) throw new WorkbenchError("INDEX_OUT_OF_RANGE", `frameIndex must be below ${Math.max(frames.length, 1)}.`);
      const atoms = request.frameIndex !== undefined && frames.length ? frames[request.frameIndex].atoms : snapshot.source?.atoms;
      if (!atoms) throw new WorkbenchError("JOB_UNAVAILABLE", snapshot.structureError ?? snapshot.sourceError ?? "The atoms of this source could not be read.");
      return { ...base, frameIndex: request.frameIndex ?? 0, unit: "angstrom", ...page(atoms, request.offset, request.limit, (atom, index) => ({ index, element: atom.element, x: atom.x, y: atom.y, z: atom.z })) };
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
      documentId: job.document.id,
      documentTitle: job.document.title.slice(0, COMMENT_LENGTH),
      sourceRevision: job.sourceRevision,
      sourceTextSha256: job.input.sourceTextSha256,
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
    if (job.binding === "source_closed") return;
    const document = environment.documents().find((item) => item.id === job.document.id);
    if (!document) {
      closeJob(job);
      return;
    }
    try {
      assertOpen(document, job.input.lifetime);
      const { revision } = await snapshotOf({ documentId: document.id });
      assertOpen(document, job.input.lifetime);
      job.binding = revision === job.sourceRevision ? "current" : "stale";
    } catch (error) {
      if (error instanceof WorkbenchError && error.code === "SOURCE_CLOSED") closeJob(job);
      else if (!job.input.lifetime.abort.signal.aborted) job.binding = "stale";
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

  function runJob(job: Job, signal: AbortSignal) {
    const { input, request } = job;
    return runner(request.kind).run(input, request.params as WorkbenchJobParams<typeof request.kind>, {
      signal, timeoutMs: WORKBENCH_LIMITS.jobTimeoutMs, stem: fileStem(input.document.title), artifact,
    });
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
    const reason = jobUnavailable(snapshot, request.job);
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
      throw new WorkbenchError("STALE_RESULT", `The source of ${job.document.title} changed after job ${job.jobId} was submitted. Pass allowStale: true to export a result of the earlier revision ${job.sourceRevision}.`, { job: publicJob(job) });
    }
    const found = job.artifacts.find((item) => item.name === request.artifact);
    if (!found) throw new WorkbenchError("ARTIFACT_NOT_FOUND", `Job ${job.jobId} has no ${request.artifact} artifact.`, { artifacts: job.artifacts.map((item) => item.name) });
    // The content is the artifact transport: the CLI writes it to a file and drops it from the action log.
    return {
      jobId: job.jobId,
      sourceRevision: job.sourceRevision,
      sourceTextSha256: job.input.sourceTextSha256,
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
        if (!openDocumentIds.has(job.document.id) && job.binding !== "source_closed") closeJob(job);
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
