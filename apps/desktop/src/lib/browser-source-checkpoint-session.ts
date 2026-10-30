import type { ViewerDocument } from "../types";
import { browserCheckpointOriginal, readBrowserSourceCheckpoint, writeBrowserSourceCheckpoint, type BrowserSourceCheckpoint } from "./browser-source-checkpoint";
import { importedOriginalFor, scientificStateFor } from "./workbench/scientific-source-state";
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
    write(session: { sessionId: string; revision: number; baseContent: string; content: string; dirty: boolean }, current: () => boolean) {
      const revision = scientificStateFor(document.id, session.content).revision;
      const next: BrowserSourceCheckpoint | null = session.dirty ? structuredClone({
        ...original, version: 1, id: `${session.sessionId}:${session.revision}`, revision: session.revision,
        baseText: session.baseContent, text: session.content, science: revision?.document ?? null,
      }) : null;
      const operation = queue.then(async () => {
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
