import { useEffect, useSyncExternalStore } from "react";
import type { DockTabKind } from "../dock";
import { useSourceEditing, type SourceEditingOperation } from "../source-editing/context";
import { useStructureSourceText } from "../source-editing/use-structure-source-text";
import { logicalSourceFor, useLogicalSource, type LogicalSource } from "../science-session/state";
import { forgetViewerAtomSelection } from "./selection";
import type { ViewerDocument } from "../../types";

/** One state of a source: its text, what was read from it and the edit that made it. */
export type TextRevision<Value, Edit extends string = string> = { id: number; text: string; value: Value; edit: Edit | null };
type History = { current: TextRevision<unknown>; undo: TextRevision<unknown>[]; redo: TextRevision<unknown>[] };
export type TextHistory<Value, Edit extends string> = { current: TextRevision<Value, Edit>; undo: TextRevision<Value, Edit>[]; redo: TextRevision<Value, Edit>[] };

type Entry = { owner: LogicalSource | null | undefined; history: History | null; error: string | null; busy: boolean; loading: string | null; controller: AbortController | null };
const EMPTY: Entry = { owner: undefined, history: null, error: null, busy: false, loading: null, controller: null };
const HISTORY_LIMIT = 100;
const MAX_DOCUMENTS = 16;
let revisionIds = 0;

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

type Reader<Value> = (text: string, signal: AbortSignal) => Promise<Value>;
/** Which source texts the tool edits, and what each revision carries. */
export type TextDraftReader<Value> = { accepts: (text: string) => boolean; read: Reader<Value> };

async function load(key: string, document: ViewerDocument, text: string, read: Reader<unknown>) {
  entries.get(key)?.controller?.abort();
  const controller = new AbortController(), owner = logicalSourceFor(document.id);
  update(key, { ...(entries.get(key)?.owner !== owner ? { history: null, busy: false, error: null } : {}), owner, loading: text, controller });
  try {
    const value = await read(text, controller.signal);
    if (controller.signal.aborted || logicalSourceFor(document.id) !== owner || entries.get(key)?.controller !== controller) return;
    update(key, { history: { current: { id: ++revisionIds, text, value, edit: null }, undo: [], redo: [] }, error: null, loading: null, controller: null });
  } catch (error) {
    if (!controller.signal.aborted && entries.get(key)?.controller === controller && logicalSourceFor(document.id) === owner && !isAbortError(error)) {
      update(key, { history: null, error: message(error), loading: null, controller: null });
    }
  }
}

/**
 * The undoable text draft of a document's own source, for edits computed from the
 * whole text. Every edit runs off the main thread, is written into the source draft
 * at the current camera and becomes one Undo step; a rejected edit leaves the draft
 * as it was. Changes to the source made elsewhere start a new history.
 *
 * `scope` keeps the histories of different tools on one document apart.
 */
export function useTextDraft<Value, Edit extends string>(scope: string, document: ViewerDocument | null, reader: TextDraftReader<Value> | null, revealTab: DockTabKind) {
  const logical = useLogicalSource(document?.id);
  const sourceEditing = useSourceEditing();
  const session = sourceEditing?.sessionForDocument(document) ?? null;
  const { text: sourceText, error: readError } = useStructureSourceText(reader ? document : null);
  const read = reader && sourceText !== null && reader.accepts(sourceText) ? reader.read : null;
  const key = read && document ? `${scope}\u0000${document.id}\u0000${document.path}` : null;
  const getSnapshot = () => (key ? entries.get(key) ?? EMPTY : EMPTY);
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!key || !document || !read || sourceText === null) return;
    if (entry.owner !== logical) { void load(key, document, sourceText, read); return; }
    if (entry.busy || entry.loading === sourceText || entry.history?.current.text === sourceText) return;
    void load(key, document, sourceText, read);
  }, [key, sourceText, entry.history?.current.text, entry.busy, entry.owner, logical]);

  const writeDraft = async (text: string, previous: TextRevision<unknown>, lifetime: SourceEditingOperation, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!lifetime.isCurrent()) throw new DOMException("The document closed while editing.", "AbortError");
    if (!sourceEditing || !document) throw new Error("This file can’t be edited here.");
    if (!sourceEditing.sessionForDocument(document)) {
      if (session) throw new Error("The source was closed. Open it again before editing.");
      await sourceEditing.beginEditing(document, revealTab);
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

  /**
   * Runs one edit as one Undo step. `compute` returns the next source text, or null
   * when the edit produced something else (a new document) and the source stays.
   * Resolves true when the edit completed.
   */
  const apply = async (edit: Edit, compute: (current: TextRevision<Value, Edit>, signal: AbortSignal) => Promise<string | null>): Promise<boolean> => {
    const started = key ? entries.get(key) : undefined;
    if (!key || !read || !started?.history || started.busy || !sourceEditing || !document || started.owner !== logicalSourceFor(document.id)) return false;
    const history = started.history, previous = history.current, owner = started.owner;
    const controller = new AbortController();
    const documentLifetime = sourceEditing.captureOperation(document);
    const lifetime = { ...documentLifetime, isCurrent: () => documentLifetime.isCurrent() && logicalSourceFor(document.id) === owner };
    update(key, { busy: true, error: null, controller });
    try {
      const text = await compute(previous as TextRevision<Value, Edit>, controller.signal);
      controller.signal.throwIfAborted();
      if (!lifetime.isCurrent()) throw new DOMException("The document closed while editing.", "AbortError");
      if (text === null) { update(key, { busy: false, controller: null }); return true; }
      const value = await read(text, controller.signal);
      await writeDraft(text, previous, lifetime, controller.signal);
      if (!lifetime.isCurrent()) throw new DOMException("The source lifetime changed while editing.", "AbortError");
      const next: TextRevision<unknown> = { id: ++revisionIds, text, value, edit };
      update(key, { history: { current: next, undo: [...history.undo, previous].slice(-HISTORY_LIMIT), redo: [] }, busy: false, controller: null });
      // Atom indices of the previous structure no longer name the same atoms.
      forgetViewerAtomSelection(document.id);
      return true;
    } catch (error) {
      if (entries.get(key)?.owner === owner && logicalSourceFor(document.id) === owner) {
        update(key, { busy: false, controller: null, error: controller.signal.aborted || isAbortError(error) ? null : message(error) });
      }
      return false;
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
    available: key !== null,
    reading: Boolean(reader && document) && sourceText === null && !readError,
    history: current ? entry.history as TextHistory<Value, Edit> | null : null,
    error: readError ?? (current ? entry.error : null),
    busy: current && entry.busy,
    session,
    // A restored scene keeps its source inside the scene; these edits need the file itself.
    editable: !logical,
    apply,
    undo: () => restore("undo"),
    redo: () => restore("redo"),
    cancel: () => entry.controller?.abort(),
  };
}
