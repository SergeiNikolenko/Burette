import type { ViewerDocument } from "../../types";
import { logicalSourceFor } from "../science-session/state";
import { readStructureText } from "../structure-text";
import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import { scientificDocumentPayload } from "../science-session/codec";
import { SCIENCE_SESSION_LIMITS } from "../science-session/contracts";
import { readMolecularStructure, readWorkbenchSource, workbenchSupportsDocument, type WorkbenchSource } from "./structure";
import type { MolecularStructure } from "../molecular-workbench/molecular-graph";
import { scientificStateFor } from "./scientific-source-state";
import { runReaderTask } from "./reader-task";
import type { WorkbenchAgentEnvironment, WorkbenchSourceRead } from "./agent-controller";

export class WorkbenchError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) { super(message); }
}
export async function sha256(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function readWorkbenchAgentSource(document: ViewerDocument, draftFor?: (document: ViewerDocument) => string | null): Promise<WorkbenchSourceRead> {
  const draft = draftFor?.(document);
  if (typeof draft === "string") return { text: draft, origin: "draft" };
  const logical = logicalSourceFor(document.id);
  if (logical) return { text: logical.text, origin: "scene-source" };
  return { text: await readStructureText(document.path), origin: "file" };
}

type DocumentLifetime = { path: string; runtimePath: string | undefined; abort: AbortController };
/** One immutable revision of a document's source, as every job of that revision sees it. */
export type Snapshot = {
  lifetime: DocumentLifetime; document: ViewerDocument; revision: string; sourceTextSha256: string;
  origin: WorkbenchSourceRead["origin"]; byteCount: number; scientific: ScientificDocument | null;
  scientificOrigin: "attached" | "parsed" | null; sourceError: string | null;
  structure: MolecularStructure | null; structureError: string | null;
  /** Exact text and logical extension the revision was read from. */
  text: string; extension: string;
  /** Atoms in source order (first frame), with the declared unit cell. */
  source: WorkbenchSource | null;
  /** Records of a multi-record SDF; their shared graph is checked by the job that reads them. */
  sdfRecords: number;
};

type ParsedSource = { scientific: ScientificDocument | null; sourceError: string | null;
  structure: MolecularStructure | null; structureError: string | null; source: WorkbenchSource | null };
/** Non-empty records of an SDF text, each without its `$$$$` terminator. */
export function sdfRecords(text: string) {
  // Every record after the first starts with the newline that ended the previous terminator.
  return text.replace(/\r\n?/gu, "\n").split(/^\$\$\$\$[^\n]*$/mu).map((record, index) => index ? record.replace(/^\n/u, "") : record).filter(record => record.trim());
}
const diagnostic = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

/** Source ownership for the existing job registry. Revisions include full science and the chemical graph. */
export function createAgentSourceOwner(environment: WorkbenchAgentEnvironment, lifetime: AbortSignal) {
  const documentLifetimes = new Map<string, DocumentLifetime>();
  // Cache parsing only. Attached data is captured on every read, including in-place changes.
  const snapshots = new Map<string, { lifetime: DocumentLifetime; pending: Promise<ParsedSource> }>();
  function assertOpen(document: ViewerDocument, opened: DocumentLifetime) {
    if (lifetime.aborted) throw new WorkbenchError("WORKBENCH_CLOSED", "The workspace closed.");
    if (opened.abort.signal.aborted || documentLifetimes.get(document.id) !== opened
      || !environment.documents().some(item => item.id === document.id && item.path === opened.path && item.runtimePath === opened.runtimePath)) {
      throw new WorkbenchError("SOURCE_CLOSED", "The source document was closed.", { documentId: document.id });
    }
  }
  async function snapshotOf(request: { documentId?: string; expectedSourceRevision?: string }): Promise<Snapshot> {
    const document = request.documentId ? environment.documents().find(item => item.id === request.documentId) : environment.activeDocument();
    if (!document) throw new WorkbenchError(request.documentId ? "DOCUMENT_NOT_FOUND" : "NO_ACTIVE_DOCUMENT", "The requested source document is not open.");
    let opened = documentLifetimes.get(document.id);
    if (!opened || opened.path !== document.path || opened.runtimePath !== document.runtimePath) {
      opened?.abort.abort();
      opened = { path: document.path, runtimePath: document.runtimePath, abort: new AbortController() };
      documentLifetimes.set(document.id, opened);
    }
    let read: WorkbenchSourceRead;
    try { read = await environment.readSource(document); }
    catch { throw new WorkbenchError("SOURCE_UNREADABLE", "Cannot read the source document.", { documentId: document.id }); }
    assertOpen(document, opened);
    const byteCount = new TextEncoder().encode(read.text).length;
    if (byteCount > 12 * 1024 * 1024) throw new WorkbenchError("SOURCE_TOO_LARGE", "Agent scientific sources are limited to 12 MiB.");
    // Capture full attached data before yielding. The quantum worker owns its smaller calculation projection.
    const attached = scientificStateFor(document.id, read.text).revision?.document ?? null;
    const payload = attached ? scientificDocumentPayload(attached) : null;
    if (payload && payload.byteLength > SCIENCE_SESSION_LIMITS.attachmentBytes) {
      throw new WorkbenchError("SOURCE_TOO_LARGE", "Agent scientific data exceeds the scene's 20 MiB data limit.");
    }
    const captured = payload?.clone() ?? null;
    const extension = logicalSourceFor(document.id)?.extension ?? document.extension.replace(/^\./u, "");
    const [textHash, attachedDigest] = await Promise.all([sha256(read.text), payload?.sha256() ?? null]);
    assertOpen(document, opened);
    const sourceTextSha256 = `sha256-${textHash}`;
    const key = `${document.id}\u0000${extension}\u0000${sourceTextSha256}\u0000${Boolean(attached)}`;
    let cached = snapshots.get(key);
    if (!cached || cached.lifetime !== opened) {
      const signal = opened.abort.signal;
      const pending = (async (): Promise<ParsedSource> => {
        let scientific: ScientificDocument | null = null, sourceError: string | null = null;
        let structure: MolecularStructure | null = null, structureError: string | null = null, source: WorkbenchSource | null = null;
        if (!attached) {
          try { scientific = await runReaderTask({ action: "parse", name: `source.${extension}`, text: read.text }, { signal }); }
          catch (error) { sourceError = diagnostic(error); }
        }
        if (workbenchSupportsDocument(document)) {
          try {
            source = await readWorkbenchSource(document, read.text, signal);
            if (source.atoms.length > 256) structureError = "Browser chemistry supports 1–256 atoms.";
            else structure = await readMolecularStructure(source, signal);
            // A valid chemical graph need not have quantum/scientific sections.
            sourceError = null;
          } catch (error) { structureError = diagnostic(error); }
        }
        return { scientific, sourceError, structure, structureError, source };
      })();
      cached = { lifetime: opened, pending }; snapshots.set(key, cached);
      pending.catch(() => { if (snapshots.get(key)?.pending === pending) snapshots.delete(key); });
      while (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value!);
    }
    const parsed = await cached.pending;
    assertOpen(document, opened);
    const scientific = captured ?? parsed.scientific;
    const parsedPayload = !attachedDigest && scientific ? scientificDocumentPayload(scientific) : null;
    if (parsedPayload && parsedPayload.byteLength > SCIENCE_SESSION_LIMITS.attachmentBytes) {
      throw new WorkbenchError("SOURCE_TOO_LARGE", "Agent scientific data exceeds the scene's 20 MiB data limit.");
    }
    const scienceDigest = attachedDigest ?? await parsedPayload?.sha256() ?? null;
    const revision = `sha256-${await sha256(JSON.stringify([sourceTextSha256, scienceDigest, parsed.structure]))}`;
    assertOpen(document, opened);
    if (request.expectedSourceRevision && request.expectedSourceRevision !== revision) {
      throw new WorkbenchError("REVISION_CONFLICT", "The source or its scientific calculation data changed. Observe again and use the current sourceRevision.",
        { documentId: document.id, expectedSourceRevision: request.expectedSourceRevision, sourceRevision: revision });
    }
    return { lifetime: opened, document: { ...document }, revision, sourceTextSha256, origin: read.origin, byteCount,
      scientific, scientificOrigin: scientific ? attached ? "attached" : "parsed" : null, sourceError: parsed.sourceError,
      structure: parsed.structure, structureError: parsed.structureError, text: read.text, extension, source: parsed.source,
      sdfRecords: extension === "sdf" || extension === "sd" ? sdfRecords(read.text).length : 0 };
  }
  return { snapshotOf, assertOpen,
    documentsChanged(openIds: ReadonlySet<string>) {
      for (const [id, opened] of documentLifetimes) if (!openIds.has(id)) { opened.abort.abort(); documentLifetimes.delete(id); }
      for (const key of snapshots.keys()) if (!openIds.has(key.split("\u0000")[0])) snapshots.delete(key);
    },
    dispose() { for (const opened of documentLifetimes.values()) opened.abort.abort(); documentLifetimes.clear(); snapshots.clear(); },
  };
}
