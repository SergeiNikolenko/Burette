import { useEffect, useSyncExternalStore } from "react";
import type { CrystalEdit, CrystalEditResult } from "../molecular-workbench/crystal-edit";
import { periodicCrystalFormat, type CrystalDocument, type CrystalFormat } from "../molecular-workbench/crystal-io";
import { useSourceEditing, type SourceEditingOperation } from "../source-editing/context";
import { useStructureSourceText } from "../source-editing/use-structure-source-text";
import { logicalSourceFor, sourceExtension, useLogicalSource, type LogicalSource } from "../science-session/state";
import { runCrystalTask } from "./crystal-task";
import { runReaderTask } from "./reader-task";
import { forgetViewerAtomSelection } from "./selection";
import { workbenchSupportsDocument } from "./structure";
import type { ViewerDocument } from "../../types";

/** One state of the crystal source: its text, the cell read from it and the edit that made it. */
export type CrystalRevision = { id: number; text: string; crystal: CrystalDocument; edit: CrystalEdit["kind"] | null; outcome: CrystalEditResult | null };
export type CrystalHistory = { current: CrystalRevision; undo: CrystalRevision[]; redo: CrystalRevision[] };
export type CrystalApplyResult = { kind: "revision"; result: CrystalEditResult } | { kind: "new-document"; result: CrystalEditResult };

type Entry = { owner: LogicalSource | null | undefined; history: CrystalHistory | null; error: string | null; busy: boolean; loading: string | null; controller: AbortController | null };
const EMPTY: Entry = { owner: undefined, history: null, error: null, busy: false, loading: null, controller: null };
const HISTORY_LIMIT = 100;
let revisionIds = 0;
const MAX_DOCUMENTS = 16;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function update(key: string, patch: Partial<Entry>) {
  const next = { ...(entries.get(key) ?? EMPTY), ...patch };
  entries.delete(key);
  entries.set(key, next);
  while (entries.size > MAX_DOCUMENTS) entries.delete(entries.keys().next().value!);
  listeners.forEach((listener) => listener());
}

const isAbortError = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** The periodic format of a document's own source text, or null for a molecule. */
export function crystalDraftFormat(document: ViewerDocument | null, text: string | null): CrystalFormat | null {
  if (!document || text === null || !workbenchSupportsDocument(document) || document.dockingRequest || document.mergedCollection) return null;
  return periodicCrystalFormat(sourceExtension(document), text);
}

/** Whether the document's current source is a crystal the Crystal panel can open. */
export function useCrystalAvailable(document: ViewerDocument | null) {
  const candidate = document && workbenchSupportsDocument(document) ? document : null;
  const { text } = useStructureSourceText(candidate);
  return crystalDraftFormat(candidate, text) !== null;
}

async function load(key: string, document: ViewerDocument, format: CrystalFormat, text: string) {
  entries.get(key)?.controller?.abort();
  const controller = new AbortController(), owner = logicalSourceFor(document.id);
  update(key, { ...(entries.get(key)?.owner !== owner ? { history: null, busy: false, error: null } : {}), owner, loading: text, controller });
  try {
    const crystal = await runReaderTask({ action: "crystal", format, text }, { signal: controller.signal });
    if (controller.signal.aborted || logicalSourceFor(document.id) !== owner || entries.get(key)?.controller !== controller) return;
    update(key, { history: { current: { id: ++revisionIds, text, crystal, edit: null, outcome: null }, undo: [], redo: [] }, error: null, loading: null, controller: null });
  } catch (error) {
    if (!controller.signal.aborted && entries.get(key)?.controller === controller && logicalSourceFor(document.id) === owner && !isAbortError(error)) {
      update(key, { history: null, error: message(error), loading: null, controller: null });
    }
  }
}

/**
 * The undoable crystal draft of a CIF, extended XYZ or POSCAR document. Every edit
 * runs in the crystal worker, is written into the document's own source draft at the
 * current camera and becomes one Undo step; a rejected edit leaves the draft as it was.
 * An asymmetric unit of a source that cannot carry symmetry opens as a new CIF instead.
 * Changes to the source made elsewhere start a new history.
 */
export function useCrystalDraft(document: ViewerDocument | null, openCif: (name: string, text: string) => Promise<unknown>) {
  const logical = useLogicalSource(document?.id);
  const sourceEditing = useSourceEditing();
  const session = sourceEditing?.sessionForDocument(document) ?? null;
  const candidate = document && workbenchSupportsDocument(document) ? document : null;
  const { text: sourceText, error: readError } = useStructureSourceText(candidate);
  const format = crystalDraftFormat(candidate, sourceText);
  const key = format && document ? `${document.id}\u0000${document.path}` : null;
  const getSnapshot = () => (key ? entries.get(key) ?? EMPTY : EMPTY);
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!key || !document || !format || sourceText === null) return;
    if (entry.owner !== logical) { void load(key, document, format, sourceText); return; }
    if (entry.busy || entry.loading === sourceText || entry.history?.current.text === sourceText) return;
    void load(key, document, format, sourceText);
  }, [key, format, sourceText, entry.history?.current.text, entry.busy, entry.owner, logical]);

  const writeDraft = async (text: string, previous: CrystalRevision, lifetime: SourceEditingOperation, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!lifetime.isCurrent()) throw new DOMException("The document closed while editing.", "AbortError");
    if (!sourceEditing || !document) throw new Error("This file can’t be edited here.");
    if (!sourceEditing.sessionForDocument(document)) {
      if (session) throw new Error("The source was closed. Open it again before editing.");
      await sourceEditing.beginEditing(document, "crystal");
      if (!sourceEditing.sessionForDocument(document)) throw new Error("This file can’t be edited here.");
    }
    signal?.throwIfAborted();
    if (!lifetime.isCurrent()) throw new DOMException("The document closed while editing.", "AbortError");
    // sessionForDocument reads the live session; never overwrite an external edit.
    const latest = sourceEditing.sessionForDocument(document);
    if (!latest || latest.documentId !== document.id || latest.content !== previous.text) throw new Error("The source changed while editing. Try again.");
    if (!latest.editable) throw new Error("This source is read-only.");
    sourceEditing.updateDraft(document, text, { view: "keep" });
    // The controller commits synchronously by replacing its session object.
    const committed = sourceEditing.sessionForDocument(document);
    if (!committed || committed === latest || committed.documentId !== document.id || committed.content !== text) throw new Error("The source could not be updated. Try again.");
  };

  /** Runs one edit as one Undo step; resolves null when it was rejected or cancelled. */
  const apply = async (edit: CrystalEdit): Promise<CrystalApplyResult | null> => {
    const started = key ? entries.get(key) : undefined;
    if (!key || !format || !started?.history || started.busy || !sourceEditing || !document || started.owner !== logicalSourceFor(document.id)) return null;
    const history = started.history, previous = history.current, owner = started.owner;
    const controller = new AbortController();
    const documentLifetime = sourceEditing.captureOperation(document);
    const lifetime = { ...documentLifetime, isCurrent: () => documentLifetime.isCurrent() && logicalSourceFor(document.id) === owner };
    update(key, { busy: true, error: null, controller });
    try {
      const result = await runCrystalTask({ action: "edit", source: { format, text: previous.text }, edit }, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (result.newDocument) {
        if (!lifetime.isCurrent()) throw new DOMException("The document closed while editing.", "AbortError");
        await openCif(`${document.title.replace(/\.[^.]+$/u, "")}-asymmetric-unit`, result.text);
        update(key, { busy: false, controller: null });
        return { kind: "new-document", result };
      }
      const crystal = await runReaderTask({ action: "crystal", format, text: result.text }, { signal: controller.signal });
      await writeDraft(result.text, previous, lifetime, controller.signal);
      if (!lifetime.isCurrent()) throw new DOMException("The source lifetime changed while editing.", "AbortError");
      const next: CrystalRevision = { id: ++revisionIds, text: result.text, crystal, edit: edit.kind, outcome: result };
      update(key, { history: { current: next, undo: [...history.undo, previous].slice(-HISTORY_LIMIT), redo: [] }, busy: false, controller: null });
      // Atom indices of the previous cell no longer name the same atoms.
      forgetViewerAtomSelection(document.id);
      return { kind: "revision", result };
    } catch (error) {
      if (entries.get(key)?.owner === owner && logicalSourceFor(document.id) === owner) {
        update(key, { busy: false, controller: null, error: controller.signal.aborted || isAbortError(error) ? null : message(error) });
      }
      return null;
    } finally {
      lifetime.release();
    }
  };

  const restore = async (direction: "undo" | "redo") => {
    const started = key ? entries.get(key) : undefined;
    const history = started?.history;
    if (!key || !history || started.busy || !sourceEditing || !document || started.owner !== logicalSourceFor(document.id)) return;
    const target = direction === "undo" ? history.undo.at(-1) : history.redo[0];
    if (!target) return;
    const owner = started.owner, documentLifetime = sourceEditing.captureOperation(document);
    const lifetime = { ...documentLifetime, isCurrent: () => documentLifetime.isCurrent() && logicalSourceFor(document.id) === owner };
    update(key, { busy: true, error: null });
    try {
      await writeDraft(target.text, history.current, lifetime);
      if (!lifetime.isCurrent()) throw new DOMException("The source lifetime changed while editing.", "AbortError");
      update(key, { busy: false, history: direction === "undo"
        ? { current: target, undo: history.undo.slice(0, -1), redo: [history.current, ...history.redo] }
        : { current: target, undo: [...history.undo, history.current].slice(-HISTORY_LIMIT), redo: history.redo.slice(1) } });
      forgetViewerAtomSelection(document.id);
    } catch (error) {
      if (entries.get(key)?.owner === owner && logicalSourceFor(document.id) === owner) update(key, { busy: false, error: isAbortError(error) ? null : message(error) });
    } finally {
      lifetime.release();
    }
  };

  const current = entry.owner === logical;
  return {
    format,
    history: current ? entry.history : null,
    error: readError ?? (current ? entry.error : null),
    busy: current && entry.busy,
    session,
    // A restored scene keeps its source inside the scene; crystal edits need the file itself.
    editable: !logical,
    apply,
    undo: () => restore("undo"),
    redo: () => restore("redo"),
    cancel: () => entry.controller?.abort(),
  };
}
