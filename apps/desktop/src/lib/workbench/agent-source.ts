import type { ViewerDocument } from "../../types";
import { logicalSourceFor } from "../science-session/state";
import { readStructureText } from "../structure-text";
import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import { quantumCalculationInput } from "../molecular-workbench/quantum-client";
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
export type Snapshot = {
  lifetime: DocumentLifetime; document: ViewerDocument; revision: string; sourceTextSha256: string;
  origin: WorkbenchSourceRead["origin"]; byteCount: number; scientific: ScientificDocument | null;
  scientificOrigin: "attached" | "parsed" | null; sourceError: string | null;
};

/** Source ownership for the existing job registry. Revisions include the actual calculation data. */
export function createAgentSourceOwner(environment: WorkbenchAgentEnvironment, lifetime: AbortSignal) {
  const documentLifetimes = new Map<string, DocumentLifetime>();
  // Cache parsing only. Attached data is projected on every read so in-place changes cannot hide behind object identity.
  const snapshots = new Map<string, { lifetime: DocumentLifetime; pending: Promise<ScientificDocument> }>();
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
    // Project attached input synchronously before the first digest await; jobs never retain a mutable scientific owner.
    const attached = scientificStateFor(document.id, read.text).revision?.document ?? null;
    let scientific: ScientificDocument | null = null, sourceError: string | null = null;
    if (attached) {
      try { scientific = quantumCalculationInput(attached); }
      catch (error) { sourceError = (error instanceof Error ? error.message : String(error)).slice(0, 500); }
    }
    const sourceTextSha256 = `sha256-${await sha256(read.text)}`;
    if (!attached) {
      const extension = logicalSourceFor(document.id)?.extension ?? document.extension.replace(/^\./u, "");
      const key = `${document.id}\u0000${extension}\u0000${sourceTextSha256}`;
      let cached = snapshots.get(key);
      if (!cached || cached.lifetime !== opened) {
        const pending = runReaderTask({ action: "parse", name: `source.${extension}`, text: read.text }, { signal: opened.abort.signal });
        cached = { lifetime: opened, pending };
        snapshots.set(key, cached);
        pending.catch(() => { if (snapshots.get(key)?.pending === pending) snapshots.delete(key); });
        while (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value!);
      }
      try { scientific = quantumCalculationInput(await cached.pending); }
      catch (error) { sourceError = (error instanceof Error ? error.message : String(error)).slice(0, 500); }
    }
    assertOpen(document, opened);
    const revision = `sha256-${await sha256(JSON.stringify([sourceTextSha256, scientific]))}`;
    assertOpen(document, opened);
    if (request.expectedSourceRevision && request.expectedSourceRevision !== revision) {
      throw new WorkbenchError("REVISION_CONFLICT", "The source or its scientific calculation data changed. Observe again and use the current sourceRevision.",
        { documentId: document.id, expectedSourceRevision: request.expectedSourceRevision, sourceRevision: revision });
    }
    return { lifetime: opened, document: { ...document }, revision, sourceTextSha256, origin: read.origin, byteCount,
      scientific, scientificOrigin: scientific ? attached ? "attached" : "parsed" : null, sourceError };
  }
  return { snapshotOf, assertOpen,
    documentsChanged(openIds: ReadonlySet<string>) {
      for (const [id, opened] of documentLifetimes) if (!openIds.has(id)) { opened.abort.abort(); documentLifetimes.delete(id); }
      for (const key of snapshots.keys()) if (!openIds.has(key.split("\u0000")[0])) snapshots.delete(key);
    },
    dispose() { for (const opened of documentLifetimes.values()) opened.abort.abort(); documentLifetimes.clear(); snapshots.clear(); },
  };
}
