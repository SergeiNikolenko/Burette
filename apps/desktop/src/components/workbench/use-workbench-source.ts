import { useEffect, useMemo, useRef, useState } from "react";
import type { MolecularStructure } from "../../lib/molecular-workbench/chemistry";
import { isAbortError } from "../../lib/viewer-errors";
import { useStructureSourceText } from "../../lib/source-editing/use-structure-source-text";
import { logicalSourceFor, useLogicalSource } from "../../lib/science-session/state";
import { chemistryError, readMolecularStructure, readWorkbenchSource, workbenchSupportsDocument, type WorkbenchSource } from "../../lib/workbench/structure";
import type { ViewerDocument } from "../../types";

export type WorkbenchSourceState = {
  source: WorkbenchSource | null;
  structure: MolecularStructure | null;
  /** Why the atoms or the chemical graph could not be read. */
  error: string | null;
  structureError: string | null;
  loading: boolean;
  /** Identity of the source these values were read from; changes with every edit or lifetime replacement. */
  revision: string | null;
};

let revisions = 0;
const IDLE: WorkbenchSourceState = { source: null, structure: null, error: null, structureError: null, loading: false, revision: null };

/**
 * Atoms of the document's current source and, when requested, its chemical graph.
 * Values are only returned for the exact source text they were read from: while a
 * new revision loads, nothing stale is exposed, and reads in flight are aborted.
 */
export function useWorkbenchSource(document: ViewerDocument | null, options: { graph?: boolean } = {}): WorkbenchSourceState {
  // Restoring a MOLX can make it supported after this surface already mounted.
  const logical = useLogicalSource(document?.id);
  const supported = workbenchSupportsDocument(document);
  const { text, error: readError } = useStructureSourceText(supported ? document : null);
  const wantsGraph = Boolean(options.graph);
  // A replacement document or logical restore starts a fresh lifetime, even with identical text.
  const revision = useMemo(() => (supported && document && text !== null ? `${document.id}:${++revisions}` : null), [supported, document, logical, text, wantsGraph]);
  const latest = useRef(revision); latest.current = revision;
  const [state, setState] = useState<WorkbenchSourceState>(IDLE);
  useEffect(() => {
    if (!revision || !document || text === null) return undefined;
    const controller = new AbortController();
    const active = () => !controller.signal.aborted && latest.current === revision && logicalSourceFor(document.id) === logical;
    const settle = (next: Omit<WorkbenchSourceState, "revision">) => { if (active()) setState({ ...next, revision }); };
    void (async () => {
      let source: WorkbenchSource;
      try {
        source = await readWorkbenchSource(document, text, controller.signal);
      } catch (error) {
        if (!isAbortError(error)) settle({ ...IDLE, error: chemistryError(error) });
        return;
      }
      if (!active()) return;
      if (!wantsGraph) { settle({ ...IDLE, source }); return; }
      try {
        settle({ ...IDLE, source, structure: await readMolecularStructure(source, controller.signal) });
      } catch (error) {
        if (!isAbortError(error)) settle({ ...IDLE, source, structureError: chemistryError(error) });
      }
    })();
    return () => controller.abort();
  }, [revision]);
  if (!supported) return IDLE;
  if (readError) return { ...IDLE, error: readError };
  return state.revision === revision && revision !== null ? state : { ...IDLE, loading: true };
}

/**
 * Runs one cancellable job at a time. Changing `revision` (the source the job
 * was started from) or unmounting aborts the job and drops its result.
 */
export function useCancellableJob(revision: string | null = null) {
  const currentRevision = useRef(revision); currentRevision.current = revision;
  const controller = useRef<AbortController | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = () => { controller.current?.abort(); controller.current = null; setRunning(null); };
  useEffect(() => { setError(null); return cancel; }, [revision]);
  const run = async <T,>(label: string, job: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    controller.current?.abort();
    const own = new AbortController();
    controller.current = own;
    setRunning(label);
    setError(null);
    try {
      const result = await job(own.signal);
      return own.signal.aborted || currentRevision.current !== revision ? null : result;
    } catch (caught) {
      if (controller.current === own && currentRevision.current === revision && !isAbortError(caught) && !own.signal.aborted) setError(chemistryError(caught));
      return null;
    } finally {
      if (controller.current === own) { controller.current = null; setRunning(null); }
    }
  };
  return { running, error, setError, run, cancel };
}
