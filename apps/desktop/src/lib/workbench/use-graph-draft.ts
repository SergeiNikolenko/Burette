import { useEffect, useSyncExternalStore } from "react";
import type { EnergyModelId, MolecularAtom, Vec3 } from "../molecular-workbench/types";
import type { EnergyModelChoice } from "../molecular-workbench/energy-models";
import type { ConstraintResidual, GeometryConstraint, OptimizationMethod, OptimizationProgress } from "../molecular-workbench/optimization";
import { runGraphTask } from "../molecular-workbench/graph-compute-client";
import type { GraphEdit, GraphEditResult } from "../molecular-workbench/graph-edit";
import type { FragmentSource } from "../molecular-workbench/fragment-source";
import { useSourceEditing, type SourceEditingOperation } from "../source-editing/context";
import { graphDraftText, graphSourceMetadata, structureEditAvailable } from "./graph-draft";
import { atomAnnotations, type AtomAnnotation } from "./graph-annotations";
import { checkHydrogenSourcePose, normalizeGraphOrder, replaceGraphPositions } from "./graph-positions";
import { forgetViewerAtomSelection } from "./selection";
import { useStructureSourceText } from "../source-editing/use-structure-source-text";
import type { ViewerDocument } from "../../types";
import { patchGraphMetadata, remapGraphMetadata, type GraphMetadata, type GraphMetadataPatch } from "./graph-metadata";
import { graphAtomIds, logicalSourceFor, rememberGraphAtomIds, sourceExtension, useLogicalSource, type LogicalSource } from "../science-session/state";
import { prepareMeasurementSourcePair, publishMeasurementSourcePair } from "./measurement-preview";

/** What an optimization did, kept with the snapshot it produced. Energies in kcal/mol. */
export type GraphOutcome = {
  forceField?: EnergyModelId; method: string; initialEnergy: number; energy: number; converged: boolean; iterations?: number | null;
  /** Step geometries with physical energies; absent or two endpoint frames when the minimizer exposes no steps. */
  frames?: { atoms: MolecularAtom[]; energy: number }[]; frameSampling?: "steps" | "endpoints";
  /** Measured values of the held distances, angles and dihedrals at the result. */
  residuals?: ConstraintResidual[];
};
export type GraphSnapshot = { structure: GraphEditResult; annotations: AtomAnnotation[]; text: string; outcome: GraphOutcome | null; metadata: GraphMetadata | null; atomIds: readonly string[] | null;
  /** Camera policy for the transition into this snapshot, also used when undoing it. */
  view?: "fit";
};
// `origin` is the source the history started from; its title and SDF data items
// carry into every draft. `current.text` is what the draft holds for this snapshot.
export type GraphHistory = { origin: string; current: GraphSnapshot; undo: GraphSnapshot[]; redo: GraphSnapshot[] };
export type GraphOperation =
  | { kind: "metadata"; patch: GraphMetadataPatch; from: GraphSnapshot }
  | { kind: "edits"; edits: GraphEdit[] }
  | { kind: "remove-hydrogens" }
  | GraphAdvancedOperation
  // New coordinates for every atom, in order, of exactly the snapshot `from` (symmetrize).
  | { kind: "positions"; coordinates: Vec3[]; from: GraphSnapshot };

// `prepare-3d` embeds a flat depiction with hydrogens and relaxes it; source atoms keep their indices.
export type GraphAdvancedOperation = { kind: "add-hydrogens" } | { kind: "prepare-3d" }
  // Constraint atom indices refer to the current snapshot; the atoms keep their indices.
  | { kind: "optimize"; method: OptimizationMethod; forceField: EnergyModelChoice; maxIterations?: number; constraints?: GeometryConstraint[] }
  // One rigid fragment bonded to `target` in place of a hydrogen, or a separate molecule when `target` is null.
  | { kind: "insert-fragment"; fragment: FragmentSource; target: number | null }
  // Protonation states for `pH`, then every hydrogen explicit; heavy atoms keep their indices and coordinates.
  | { kind: "protonate"; pH: number };
export type GraphComputeResult = { structure: GraphEditResult; outcome: GraphOutcome | null };
export type GraphAdvancedCompute = (operation: GraphAdvancedOperation, structure: GraphEditResult, signal: AbortSignal, onProgress: (progress: OptimizationProgress) => void) => Promise<GraphComputeResult>;

// The adopted logical object owns its history and pending work. Null denotes an ordinary file.
type Entry = { owner: LogicalSource | null | undefined; history: GraphHistory | null; error: string | null; busy: boolean; loading: string | null; controller: AbortController | null;
  /** The latest minimizer step of the running optimization. */
  progress: OptimizationProgress | null };
const EMPTY: Entry = { owner: undefined, history: null, error: null, busy: false, loading: null, controller: null, progress: null };
const HISTORY_LIMIT = 100;
const MAX_DOCUMENTS = 16;

// One history per document, shared by every surface that edits it (the Edit tab and
// Properties), so an operation started in either is one Undo step in the same draft.
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

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function snapshot(structure: GraphEditResult, text: string, outcome: GraphOutcome | null, metadata: GraphMetadata | null, atomIds: readonly string[] | null = null): GraphSnapshot {
  return { structure, annotations: atomAnnotations(structure.molfile), text, outcome, metadata, atomIds: metadata?.atoms.map(atom => atom.id) ?? atomIds };
}

function remapAtomIds(ids: readonly string[] | null, mapping: readonly number[], sourceCount: number, targetCount: number) {
  const sources = Array.from(mapping), survivors = sources.filter(index => index !== -1);
  if (sources.length !== targetCount || (ids && ids.length !== sourceCount)
    || survivors.some(index => !Number.isInteger(index) || index < 0 || index >= sourceCount) || new Set(survivors).size !== survivors.length) throw new Error("The graph edit has invalid atom provenance.");
  if (!ids) return null;
  return sources.map(index => index === -1 ? crypto.randomUUID() : ids[index]);
}

async function load(key: string, document: ViewerDocument, text: string) {
  entries.get(key)?.controller?.abort();
  const controller = new AbortController(), owner = logicalSourceFor(document.id);
  update(key, { ...(entries.get(key)?.owner !== owner ? { history: null, busy: false, error: null } : {}), owner, loading: text, controller });
  try {
    const parsed = await runGraphTask({ action: "parse", source: text, format: sourceExtension(document) === "mol" ? "mol" : "sdf" }, { signal: controller.signal });
    const structure = await normalizeGraphOrder(parsed, controller.signal);
    if (controller.signal.aborted || logicalSourceFor(document.id) !== owner || entries.get(key)?.controller !== controller) return;
    update(key, { history: { origin: text, current: snapshot(structure, text, null, graphSourceMetadata(text, sourceExtension(document), structure.atoms.length), sourceExtension(document) === "mol" ? graphAtomIds(document.id, text, structure.atoms.length) : null), undo: [], redo: [] }, error: null, loading: null, controller: null });
  } catch (error) {
    if (!controller.signal.aborted && entries.get(key)?.controller === controller && logicalSourceFor(document.id) === owner && !isAbortError(error)) update(key, { history: null, error: message(error), loading: null, controller: null });
  }
}

async function compute(operation: Exclude<GraphOperation, { kind: "metadata" }>, structure: GraphEditResult, signal: AbortSignal, onProgress: (progress: OptimizationProgress) => void, advanced?: GraphAdvancedCompute): Promise<GraphComputeResult> {
  if (operation.kind === "edits") return { structure: await runGraphTask({ action: "edit-graph", molecule: structure, edits: operation.edits }, { signal }), outcome: null };
  if (operation.kind === "positions") {
    return { structure: await replaceGraphPositions(structure, operation.coordinates, signal), outcome: null };
  }
  if (operation.kind === "remove-hydrogens") {
    const indices = structure.atoms.flatMap((atom, index) => atom.element === "H" ? [index] : []);
    return { structure: indices.length ? await runGraphTask({ action: "edit-graph", molecule: structure, edits: [{ kind: "delete-atoms", indices }] }, { signal })
      : { ...structure, sourceAtomIndices: structure.atoms.map((_, index) => index) }, outcome: null };
  }
  if (!advanced) throw new Error("This graph operation is not available here.");
  return advanced(operation, structure, signal, onProgress);
}

/**
 * The undoable graph draft of an SDF/MOL document. Every operation computes the
 * next structure in a worker, writes it into the document's own draft at the
 * current camera (refitting generated 3D poses), and becomes one Undo step; a rejected operation leaves the
 * draft untouched. Changes to the source made elsewhere start a new history.
 */
export function useGraphDraft(document: ViewerDocument | null, computeAdvanced?: GraphAdvancedCompute, startEditing?: (document: ViewerDocument) => void | Promise<void>) {
  const logical = useLogicalSource(document?.id);
  const sourceEditing = useSourceEditing();
  const session = sourceEditing?.sessionForDocument(document) ?? null;
  const enabled = structureEditAvailable(document);
  const { text: sourceText, error: readError } = useStructureSourceText(enabled ? document : null);
  const key = enabled && document ? `${document.id}\u0000${document.path}` : null;
  const getSnapshot = () => (key ? entries.get(key) ?? EMPTY : EMPTY);
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!key || !document || sourceText === null) return;
    if (entry.owner !== logical) { void load(key, document, sourceText); return; }
    if (entry.busy || entry.loading === sourceText) return;
    if (entry.history?.current.text === sourceText && (sourceExtension(document) !== "mol" || entry.history.current.atomIds === graphAtomIds(document.id, sourceText, entry.history.current.structure.atoms.length))) return;
    void load(key, document, sourceText);
  }, [key, sourceText, entry.history?.current.text, entry.busy, entry.owner, logical]);

  const writeDraft = async (text: string, previous: GraphSnapshot, lifetime: SourceEditingOperation, signal?: AbortSignal, validateBeforeWrite?: () => Promise<void>, publishPair?: () => void, view: "keep" | "fit" = "keep") => {
    signal?.throwIfAborted();
    if (!lifetime.isCurrent()) throw new DOMException("The document closed while editing.", "AbortError");
    if (!sourceEditing || !document) throw new Error("This file can’t be edited here.");
    const current = sourceEditing.sessionForDocument(document);
    if (!current) {
      if (session) throw new Error("The source was closed. Open it again before editing.");
      await (startEditing ? startEditing(document) : sourceEditing.beginEditing(document));
    }
    await validateBeforeWrite?.();
    signal?.throwIfAborted();
    if (!lifetime.isCurrent()) throw new DOMException("The document closed while editing.", "AbortError");
    // sessionForDocument reads the controller's live ref, even after an awaited
    // worker or beginEditing. Never overwrite an external edit or a closed source.
    const latest = sourceEditing.sessionForDocument(document);
    if (!latest || latest.documentId !== document.id || latest.content !== previous.text) throw new Error("The source changed while editing. Try again.");
    if (!latest.editable) throw new Error("This source is read-only.");
    if (sourceExtension(document) === "mol" && graphAtomIds(document.id, previous.text, previous.structure.atoms.length) !== previous.atomIds) throw new Error("The source identity changed while editing. Try again.");
    sourceEditing.updateDraft(document, text, { view });
    // The controller commits synchronously by replacing its live session object.
    // A thrown or ignored write cannot authorize an uncommitted source, including
    // a byte-identical edit. Do not await between this acknowledgement and publish.
    const committed = sourceEditing.sessionForDocument(document);
    if (!committed || committed === latest || committed.documentId !== document.id || !committed.editable || committed.content !== text) throw new Error("The source could not be updated. Try again.");
    if (!lifetime.isCurrent()) throw new DOMException("The source lifetime changed while editing.", "AbortError");
    publishPair?.();
  };

  /** Runs one operation as one Undo step. Resolves with the new structure, or null when it was rejected. */
  const apply = async (operation: GraphOperation, options?: { signal?: AbortSignal; isCurrent?: () => boolean; validateBeforeWrite?: () => Promise<void> }): Promise<GraphEditResult | null> => {
    const signal = options?.signal;
    const started = key ? entries.get(key) : undefined;
    if (!key || !started?.history || started.busy) return null;
    if (!sourceEditing || !document || signal?.aborted || started.owner !== logicalSourceFor(document.id)) return null;
    const history = started.history;
    if ((operation.kind === "positions" || operation.kind === "metadata") && operation.from !== history.current) {
      update(key, { error: "The structure changed after it was analyzed. Try again." });
      return null;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const documentLifetime = sourceEditing.captureOperation(document), owner = started.owner;
    const lifetime = { ...documentLifetime, isCurrent: () => documentLifetime.isCurrent() && options?.isCurrent?.() !== false && logicalSourceFor(document.id) === owner };
    update(key, { busy: true, error: null, controller, progress: null });
    try {
      if (!lifetime.isCurrent()) throw new DOMException("The document closed while editing.", "AbortError");
      const previous = history.current;
      if (operation.kind === "metadata" && !previous.metadata) throw new Error("Metadata editing requires an SDF record.");
      if (operation.kind === "add-hydrogens" || operation.kind === "protonate") {
        checkHydrogenSourcePose(previous.text, previous.structure);
      }
      const result = operation.kind === "metadata" ? { structure: previous.structure, outcome: previous.outcome } : await compute(operation, previous.structure, controller.signal, (progress) => { if (entries.get(key)?.controller === controller) update(key, { progress }); }, computeAdvanced);
      controller.signal.throwIfAborted();
      const metadata = !previous.metadata ? null : operation.kind === "metadata" ? patchGraphMetadata(previous.metadata, operation.patch)
        : operation.kind === "positions" || operation.kind === "optimize" ? previous.metadata : remapGraphMetadata(previous.metadata, result.structure.sourceAtomIndices);
      const atomIds = previous.metadata ? null : operation.kind === "positions" || operation.kind === "optimize" ? previous.atomIds : remapAtomIds(previous.atomIds, result.structure.sourceAtomIndices, previous.structure.atoms.length, result.structure.atoms.length);
      if (atomIds && atomIds.length !== result.structure.atoms.length) throw new Error("The graph edit has incomplete atom provenance.");
      const next = snapshot(result.structure, graphDraftText(history.origin, sourceExtension(document!), result.structure.molfile, metadata), result.outcome, metadata, atomIds);
      // A separate molecule is placed beside the structure, so the view widens to show it.
      if (operation.kind === "prepare-3d" || (operation.kind === "insert-fragment" && operation.target === null)) next.view = "fit";
      // An atom reorder keeps the graph; measurements follow their atoms to the new rows.
      const reorder = operation.kind === "edits" && operation.edits.every(edit => edit.kind === "reorder-atoms");
      const pair = (operation.kind === "positions" || operation.kind === "metadata" || reorder) && ["sdf", "sd", "mol"].includes(sourceExtension(document))
        ? await prepareMeasurementSourcePair(previous.text, next.text, result.structure.atoms.length, sourceExtension(document) === "mol" ? "mol" : "sdf", reorder ? result.structure.sourceAtomIndices : undefined) : null;
      await writeDraft(next.text, history.current, lifetime, controller.signal, options?.validateBeforeWrite,
        () => {
          if (pair) publishMeasurementSourcePair(document.id, pair);
          if (sourceExtension(document) === "mol") rememberGraphAtomIds(document.id, next.text, next.atomIds);
        }, next.view);
      if (!lifetime.isCurrent()) throw new DOMException("The source lifetime changed while editing.", "AbortError");
      update(key, { history: { origin: history.origin, current: next, undo: [...history.undo, history.current].slice(-HISTORY_LIMIT), redo: [] }, busy: false, controller: null, progress: null });
      // Publish the new snapshot before clearing indices of the previous scene.
      // Consumers can then distinguish a replaced scene from a user clearing it.
      forgetViewerAtomSelection(document.id);
      return result.structure;
    } catch (error) {
      if (entries.get(key)?.owner === owner && logicalSourceFor(document.id) === owner) update(key, { busy: false, controller: null, progress: null, error: controller.signal.aborted || isAbortError(error) ? null : message(error) });
      return null;
    } finally {
      signal?.removeEventListener("abort", abort);
      lifetime.release();
    }
  };

  const restore = async (direction: "undo" | "redo") => {
    const started = key ? entries.get(key) : undefined;
    const history = started?.history;
    if (!key || !history || started.busy) return;
    if (!sourceEditing || !document || started.owner !== logicalSourceFor(document.id)) return;
    const target = direction === "undo" ? history.undo.at(-1) : history.redo[0];
    if (!target) return;
    const documentLifetime = sourceEditing.captureOperation(document), owner = started.owner;
    const lifetime = { ...documentLifetime, isCurrent: () => documentLifetime.isCurrent() && logicalSourceFor(document.id) === owner };
    update(key, { busy: true, error: null });
    try {
      await writeDraft(target.text, history.current, lifetime, undefined, undefined, () => {
        if (sourceExtension(document) === "mol") rememberGraphAtomIds(document.id, target.text, target.atomIds);
      }, (direction === "undo" ? history.current : target).view);
      if (!lifetime.isCurrent()) throw new DOMException("The source lifetime changed while editing.", "AbortError");
      update(key, { busy: false, history: direction === "undo"
        ? { origin: history.origin, current: target, undo: history.undo.slice(0, -1), redo: [history.current, ...history.redo] }
        : { origin: history.origin, current: target, undo: [...history.undo, history.current].slice(-HISTORY_LIMIT), redo: history.redo.slice(1) } });
      forgetViewerAtomSelection(document.id);
    } catch (error) {
      if (entries.get(key)?.owner === owner && logicalSourceFor(document.id) === owner) update(key, { busy: false, error: isAbortError(error) ? null : message(error) });
    } finally {
      lifetime.release();
    }
  };

  const cancel = () => entry.controller?.abort();

  const current = entry.owner === logical;
  return {
    history: current ? entry.history : null,
    error: readError ?? (current ? entry.error : null),
    loading: (!current || !entry.history) && !(current && entry.error) && !readError,
    busy: current && entry.busy,
    progress: current && entry.busy ? entry.progress : null,
    session,
    apply,
    undo: () => restore("undo"),
    redo: () => restore("redo"),
    cancel,
  };
}
