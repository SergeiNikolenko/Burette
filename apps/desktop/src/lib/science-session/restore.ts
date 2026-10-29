import { useEffect } from "react";
import { sameSceneSource } from "./source-identity";
export { sameSceneSource } from "./source-identity";
import { toast } from "../../components/ui/toast";
import type { ViewerDocument } from "../../types";
import { isMesoscaleViewerDocument } from "../mesoscale-documents";
import { requestViewerAction } from "../viewer-bridge";
import { adoptRestoredScientificSource, releaseScopedScientificSource, type ImportedRevision } from "../workbench/scientific-source-state";
import { decodeScienceSession, sha256Hex, ScienceSessionError, SCIENCE_SESSION_LIMITS } from "./codec";
import { checkBindingReport, checkSceneShowsSource } from "./scene-binding";
import { readSceneDocumentBytes } from "./source-bytes";
import { adoptLogicalSource, beginScienceSessionRestore, releaseClosedScienceSessions, rememberRevisionAtomIds } from "./state";

export type RestoreDependencies = {
  readBytes: (document: ViewerDocument) => Promise<Uint8Array>;
  request: typeof requestViewerAction;
  isOpen: (documentId: string) => boolean;
  /** Milliseconds between scene readiness checks. */
  pollMs?: number;
};

export type RestoreOutcome = "foreign" | "restored" | "cancelled";

const READY_POLL_MS = 500;
const BINDING_KEYS = ["structureRef", "modelRef", "trajectoryRef", "frameIndex", "frameCount", "atomCount"] as const;

export function isScienceSessionCandidate(document: ViewerDocument): boolean {
  return document.renderer === "molstar" && document.extension.replace(/^\./u, "").toLowerCase() === "molx" && !isMesoscaleViewerDocument(document);
}

// A scene in a background tab mounts its viewer only when shown; the restore waits for as
// long as the document stays open.
async function sceneReady(document: ViewerDocument, dependencies: RestoreDependencies) {
  for (;;) {
    if (!dependencies.isOpen(document.id)) return false;
    try {
      const state = await dependencies.request(document.id, { type: "workspace_scene_state" }, 5_000);
      if (!dependencies.isOpen(document.id)) return false;
      if (state.ready === true) return true;
    } catch {
      // The scene frame is still mounting.
    }
    await new Promise((resolve) => setTimeout(resolve, dependencies.pollMs ?? READY_POLL_MS));
  }
}

/**
 * Restores the scientific state of an opened MOLX scene into its runtime document. The
 * archive is validated completely, then the restored scene must show exactly the saved
 * structure (refs, frame, atoms and positions); only then is the state adopted, in one step.
 * A foreign scene (no manifest) is left as it is. Any failure is a named error: the scene
 * stays open without scientific data, never with part of it.
 */
export async function restoreScienceSession(document: ViewerDocument, dependencies: RestoreDependencies): Promise<RestoreOutcome> {
  const isCurrentGeneration = beginScienceSessionRestore(document.id);
  const isCurrent = () => isCurrentGeneration() && dependencies.isOpen(document.id);
  if (!isCurrent()) return "cancelled";
  try {
    if (document.byteCount > SCIENCE_SESSION_LIMITS.archiveBytes) throw new ScienceSessionError("limit", "The scene archive exceeds the 32 MiB scientific restore limit.");
    const bytes = await dependencies.readBytes(document);
    if (!isCurrent()) return "cancelled";
    const content = await decodeScienceSession(bytes);
    if (!isCurrent()) return "cancelled";
    if (!content) return "foreign";
    if (!await sceneReady(document, { ...dependencies, isOpen: isCurrent })) return "cancelled";
    const graph = content.source.extension !== "xyz";
    const report = checkBindingReport(await dependencies.request(document.id, { type: "scene_science_binding", ...(graph ? { sourceExtension: content.source.extension } : {}) }));
    if (!isCurrent()) return "cancelled";
    if (BINDING_KEYS.some((key) => report[key] !== content.binding[key])) {
      throw new ScienceSessionError("binding", "The scene structure does not match its scientific data.");
    }
    const frames = checkSceneShowsSource(report, content.source.text, content.source.extension);
    if (graph && report.sourceSha256 !== await sha256Hex(content.source.text)) throw new ScienceSessionError("binding", "The scene graph does not match its saved source.");
    if (!isCurrent()) return "cancelled";
    if (!report.importToken) throw new ScienceSessionError("binding", "The scene did not report its import identity.");
    const acknowledgement = await dependencies.request(document.id, {
      type: "scene_science_restore_ack", manifestSha256: content.manifestSha256, importToken: report.importToken,
      binding: content.binding, positions: Float64Array.from(frames[report.frameIndex].positions),
      ...(graph ? { sourceExtension: content.source.extension, sourceSha256: report.sourceSha256 } : {}),
    });
    if (!isCurrent()) return "cancelled";
    if (acknowledgement.adopted !== true) throw new ScienceSessionError("binding", "The scene could not acknowledge its scientific source.");
    const revision: ImportedRevision | null = content.science ? { text: content.source.text, document: content.science } : null;
    if (revision) rememberRevisionAtomIds(revision, content.atomIds);
    adoptRestoredScientificSource(document.id, revision, content.original);
    adoptLogicalSource({ documentId: document.id, extension: content.source.extension, text: content.source.text }, content.documentUuid, content.atomIds, frames[0].elements);
    return "restored";
  } catch (error) {
    if (!isCurrent()) return "cancelled";
    throw error;
  }
}

// Each runtime document is restored once; the entry goes when the document closes.
type RestoreEntry = { document: ViewerDocument; promise: Promise<RestoreOutcome> | null };
const started = new Map<string, RestoreEntry>();
// The window's open documents as last committed; a restore stops once its document left them.
let openDocuments: ReadonlySet<string> = new Set();
const isOpen = (documentId: string) => openDocuments.has(documentId);

/** Waits for the same open scene's restore, including a validated foreign-archive result. */
export async function waitForSceneScienceRestore(document: ViewerDocument): Promise<(() => void) | null> {
  if (!isScienceSessionCandidate(document)) return null;
  const entry = started.get(document.id);
  if (!entry?.promise || !sameSceneSource(entry.document, document)) {
    throw new ScienceSessionError("source", "Wait for this scene to finish opening, then save it again.");
  }
  const confirm = () => {
    if (!isOpen(document.id) || started.get(document.id) !== entry || !sameSceneSource(entry.document, document)) {
      throw new ScienceSessionError("source", "The scene closed or changed while it was being saved. Save the scene again.");
    }
  };
  confirm();
  const outcome = await entry.promise;
  confirm();
  if (outcome === "cancelled") throw new ScienceSessionError("source", "The scene restore was cancelled. Reopen it before saving.");
  return confirm;
}

/** Restores opened MOLX scenes and releases restored state of closed documents. Mount once per window. */
export function useScienceSessionRestore(documents: readonly ViewerDocument[]) {
  useEffect(() => {
    const open = new Set(documents.map((document) => document.id));
    openDocuments = open;
    // A replaced source cannot retain the previous scientific data, even when
    // its new archive is foreign. Metadata-only clones keep their lifetime.
    const retained = new Set(open);
    for (const document of documents) {
      const previous = started.get(document.id);
      if (previous && !sameSceneSource(previous.document, document)) {
        retained.delete(document.id);
        releaseScopedScientificSource(document.id);
      }
    }
    releaseClosedScienceSessions(retained);
    for (const id of started.keys()) if (!open.has(id)) started.delete(id);
    for (const document of documents) {
      const previous = started.get(document.id);
      if (previous && sameSceneSource(previous.document, document)) continue;
      // Replacement also revokes a pending MOLX restore when the new document is
      // another format and therefore does not start a replacement restore itself.
      started.delete(document.id);
      if (!isScienceSessionCandidate(document)) continue;
      const entry: RestoreEntry = { document, promise: null };
      started.set(document.id, entry);
      const isCurrent = () => isOpen(document.id) && started.get(document.id) === entry;
      entry.promise = restoreScienceSession(document, { readBytes: readSceneDocumentBytes, request: requestViewerAction, isOpen: isCurrent });
      void entry.promise.catch((error) => {
        if (!isCurrent()) return;
        toast.add({
          title: `Scientific data in ${document.title} could not be restored`,
          description: error instanceof Error ? error.message : String(error),
          type: "error",
        });
      });
    }
  }, [documents]);
}
