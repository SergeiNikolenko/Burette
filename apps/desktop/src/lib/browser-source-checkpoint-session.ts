import type { ViewerDocument } from "../types";
import { BROWSER_SOURCE_CHECKPOINT_BYTES, browserCheckpointOriginal, readBrowserSourceCheckpoint, writeBrowserSourceCheckpoint, type BrowserSourceCheckpoint } from "./browser-source-checkpoint";
import { importedOriginalFor, scientificStateFor } from "./workbench/scientific-source-state";
import { scientificDocumentPayload } from "./science-session/codec";
import { mcdDataForExport } from "./workbench/mcd-export";
import { logicalSourceFor } from "./science-session/state";

export type BrowserCheckpointSession = Awaited<ReturnType<typeof openBrowserCheckpointSession>>;

/** One writer belongs to the existing source session; there is no parallel source registry. */
export async function openBrowserCheckpointSession(document: ViewerDocument, isCurrent: () => boolean) {
  if (logicalSourceFor(document.id) || !importedOriginalFor(document.id)) return null;
  const original = await browserCheckpointOriginal(document.path);
  if (!original || !isCurrent()) return null;
  const checkpoint = await readBrowserSourceCheckpoint(document.path, original.scope);
  if (!isCurrent()) return null;
  let expectedId = checkpoint?.id ?? null;
  let queue = Promise.resolve();
  return {
    checkpoint,
    async write(session: { sessionId: string; revision: number; baseContent: string; content: string; dirty: boolean }, current: () => boolean) {
      const state = scientificStateFor(document.id, session.content);
      const revision = state.revision, origin = revision?.retainedScienceFrom;
      // Prove the existing witness before copying; no coordinate matching creates an owner.
      const retained = origin && origin.document.frames === revision.document.frames && origin.document.atoms === revision.document.atoms;
      const payload = revision ? scientificDocumentPayload(revision.document) : null;
      if (payload && payload.byteLength > BROWSER_SOURCE_CHECKPOINT_BYTES) throw new Error("The scientific draft exceeds the browser checkpoint limit.");
      const scienceDocument = payload?.clone() ?? null;
      const captured = {
        session: { sessionId: session.sessionId, revision: session.revision, baseContent: session.baseContent, content: session.content, dirty: session.dirty },
        revision: revision && scienceDocument ? { text: revision.text, document: scienceDocument,
          ...(retained ? { retainedScienceFrom: { text: origin.text, document: scienceDocument } } : {}) } : null,
        companions: structuredClone(state.companions),
      };
      const operation = queue.then(async () => {
        if (!current()) return;
        const projected = captured.session.dirty ? await mcdDataForExport(captured.revision, captured.session.content, captured.companions) : null;
        const next: BrowserSourceCheckpoint | null = projected ? {
          ...original, id: `${captured.session.sessionId}:${captured.session.revision}`, revision: captured.session.revision,
          baseText: captured.session.baseContent, text: captured.session.content, science: projected.science,
          ...(projected.companions?.length ? { version: 2, companions: projected.companions } : { version: 1 }),
        } : null;
        if (await writeBrowserSourceCheckpoint(original, expectedId, next, current)) expectedId = next?.id ?? null;
      });
      queue = operation.catch(() => {});
      return operation;
    },
    discard(current: () => boolean) {
      const operation = queue.then(async () => {
        if (await writeBrowserSourceCheckpoint(original, expectedId, null, current)) expectedId = null;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
