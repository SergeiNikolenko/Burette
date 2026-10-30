import { useEffect, useMemo, useRef, useState } from "react";
import "./workbench/workbench-layout.css";
import "./workbench/geometry.css";
import { Button } from "./ui/button";
import { IconAction, InternalCoordinateInput } from "./workbench/geometry-fields";
import { Copy, FileBlank, FileCode, Undo } from "./ui/app-icons";
import { Spinner } from "./ui/spinner";
import { measureGeometry } from "../../../../scripts/molecular-geometry.js";
import { parseXyzAtoms } from "../../../../scripts/internal-coordinates.mjs";
import { formatZmatrixDocument } from "../../../../scripts/zmatrix-document.mjs";
import { zmatrixDocumentFromAtoms } from "../../../../scripts/zmatrix-export.mjs";
import { runChemistryTask } from "../lib/molecular-workbench/compute-client";
import type { GeometryConstraint, MolecularForceField } from "../lib/molecular-workbench/chemistry";
import { parseXyz } from "../lib/molecular-workbench/xyz";
import { openWorkbenchDialog } from "../lib/workbench/dialog-store";
import { isAbortError } from "../lib/viewer-errors";
import { PanelEmptyState } from "./ui/panel-empty-state";
import { ConstraintToggle } from "./workbench/constraint-toggle";
import { OptimizeButton } from "./workbench/optimize-button";
import type { MinimizerMethod } from "../lib/molecular-workbench/minimizer";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { useSourceEditing } from "../lib/source-editing/context";
import { rendererXyzText } from "../lib/geometry-source-text";
import type { GeometryBinding } from "../lib/geometry-binding";
import { observeGeometryBinding } from "../lib/geometry-binding-readiness";
import { useGeometryLivePreview } from "../hooks/use-geometry-live-preview";
import { isBrowserDraftSource, readBrowserDevVirtualTextDocument } from "../lib/browser-dev-documents";
import { readStructureText } from "../lib/structure-text";
import {
  INTERNAL_COORDINATE_KINDS,
  formatInternalCoordinate,
  geometryBase,
  geometryEditableExtension,
  geometryText,
  internalCoordinateUnit,
  withInternalCoordinate,
  type GeometryBase,
  type InternalCoordinateKind,
  type ZmatrixRow,
} from "../lib/geometry-editing";
import { sourceExtension, useScientificDocument } from "../lib/workbench/source";
import { logicalSourceFor, useLogicalSource } from "../lib/science-session/state";
import { convertToInternalCoordinates } from "../lib/workbench/zmatrix-draft";
import { ZmatrixPanel } from "./workbench/zmatrix-panel";
import type { ShellActions } from "./types";
import type { ViewerDocument } from "../types";

const COLUMN_LABELS: Record<InternalCoordinateKind, string> = { bond: "Bond", angle: "Angle", dihedral: "Dihedral" };
const CONSTRAINT_KINDS = { bond: "distance", angle: "angle", dihedral: "dihedral" } as const;

/** Frozen atoms and locked internal coordinates, in source atom order. */
function geometryConstraints(rows: ZmatrixRow[], frozen: ReadonlySet<number>, locked: ReadonlySet<string>): GeometryConstraint[] {
  const constraints: GeometryConstraint[] = [...frozen].sort((a, b) => a - b).map((atom) => ({ kind: "freeze", atoms: [atom] }));
  rows.forEach((row, atom) => row.values.forEach((_, slot) => {
    if (locked.has(`${atom}:${slot}`)) constraints.push({ kind: CONSTRAINT_KINDS[INTERNAL_COORDINATE_KINDS[slot]], atoms: [atom, ...row.refs.slice(0, slot + 1)] });
  }));
  return constraints;
}

/** The same references, measured on new Cartesian positions. */
function rowsAt(rows: ZmatrixRow[], positions: number[][]): ZmatrixRow[] {
  return rows.map((row, atom) => ({ ...row, values: row.values.map((_, slot) => measureGeometry(
    CONSTRAINT_KINDS[INTERNAL_COORDINATE_KINDS[slot]],
    [atom, ...row.refs.slice(0, slot + 1)].map((index) => ({ id: String(index), position: positions[index] })),
  ).value as number) }));
}

/** XYZ text with the given positions, keeping unmoved atom lines verbatim. */
function textAt(base: GeometryBase, positions: number[][]) {
  const lines = [...base.lines];
  positions.forEach((position, index) => {
    const original = base.atoms[index].position;
    if (position.every((value, axis) => Math.abs(value - original[axis]) < 1e-12)) return;
    lines[index + 2] = [base.atoms[index].element, ...position].join(" ");
  });
  return lines.join("\n");
}

type OptimizationSummary = { forceField?: MolecularForceField; initialEnergy: number; energy: number; converged: boolean; residual: { distance: number; angle: number } | null };
const HISTORY_LIMIT = 100;

export function geometryPanelAvailable(document: ViewerDocument | null): document is ViewerDocument {
  return Boolean(document && document.renderer === "molstar" && geometryEditableExtension(sourceExtension(document))
    && (!document.virtual || isBrowserDraftSource(document)) && !document.dockingRequest && !document.mergedCollection);
}

// `base` is the source the draft started from (its exact text means "reverted").
// `frame` is the Cartesian geometry the rows are placed against; it changes only
// when coordinates are replaced wholesale (Optimize), and every Undo entry keeps
// its own frame so rows never re-anchor onto a different Cartesian geometry.
// `optimization` describes exactly this state; any edit drops it and Undo
// brings back the result of the state it returns to.
type GeometryState = { rows: ZmatrixRow[]; frame: GeometryBase; optimization?: OptimizationSummary };
// Atom orders whose own atoms cannot place every row (leading collinear atoms); a
// definition with a reference point can, so Geometry offers that conversion instead.
const NEEDS_REFERENCE_POINT = new Set(["DEGENERATE_REFERENCE_PLANE", "ILL_CONDITIONED_ANGLE"]);
type GeometryHistory = GeometryState & { text: string };
// Raw source bytes and the loader-decoded runtime baseline differ when the file starts with a UTF8 BOM.
type Editor = GeometryState & { binding: GeometryBinding; sourceText: string; base: GeometryBase; history: GeometryHistory[] };

export function GeometryPanel({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  // An imported Z-matrix edits through its own variables and reference points while the
  // source is one of its revisions; any other source is edited in Cartesian-derived rows.
  const { document: science, text } = useScientificDocument(document);
  // Each document gets its own editor: an edit still settling for the previous document
  // can only clear or report into that document's state, never into the next one's.
  const key = `${document.id}\n${document.path}`;
  if (science?.internalCoordinates && text !== null) {
    return <ZmatrixPanel key={key} document={document} actions={actions} science={{ ...science, internalCoordinates: science.internalCoordinates }} text={text} />;
  }
  // The conversion applies to exactly the text the science was read from.
  const convert = science && text !== null && science.frames.length <= 1
    ? { text, run: () => convertToInternalCoordinates(document.id, text, science) }
    : null;
  return <CartesianGeometryPanel key={key} document={document} actions={actions} convert={convert} />;
}

function CartesianGeometryPanel({ document, actions, convert }: {
  document: ViewerDocument; actions: ShellActions; convert: { text: string; run: () => void } | null;
}) {
  const sourceEditing = useSourceEditing();
  const session = sourceEditing?.sessionForDocument(document) ?? null;
  // A restored scene's text is the source it carries, never the scene file.
  const logical = useLogicalSource(document.id);
  const [fileText, setFileText] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const modelRead = useRef<object | null>(null);
  const modelLogical = useRef(logical);
  const runtimeScope = useMemo(() => ({ documentId: document.id, path: document.path, runtimePath: document.runtimePath, openClaimId: document.openClaimId }),
    [document.id, document.path, document.runtimePath, document.openClaimId]);
  const modelRuntime = useRef(runtimeScope);
  const [sourceError, setSourceError] = useState<{ message: string; needsReferencePoint: boolean } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const [frozen, setFrozen] = useState<ReadonlySet<number>>(() => new Set());
  const [locked, setLocked] = useState<ReadonlySet<string>>(() => new Set());
  const [optimizing, setOptimizing] = useState(false);
  const optimizeJob = useRef<AbortController | null>(null);
  useEffect(() => () => optimizeJob.current?.abort(), [document.id, document.path]);
  const lifetime = useRef(0);
  useEffect(() => { lifetime.current++; return () => { lifetime.current++; }; }, [document.id, document.path]);
  const live = useGeometryLivePreview(document, editor?.binding ?? null, actions.runStructureViewerAction,
    error => setEditError(error instanceof Error ? error.message : String(error)));
  // Text this panel wrote into the draft. Re-deriving rows from it would let
  // nearest-neighbour references jump after every edit.
  const written = useRef<string | null>(null);
  const baseText = useRef<string | null>(null);
  // A new session briefly reports the saved text before the first draft lands.
  const opening = useRef(false);
  const previewKey = useRef("");
  const previewSender = useRef(actions.runStructureViewerAction);
  previewSender.current = actions.runStructureViewerAction;
  useEffect(() => () => {
    if (previewKey.current) {
      previewSender.current(document, { type: "preview_geometry", label: "Geometry preview", atoms: [], notify: false });
      previewKey.current = "";
    }
  }, [document]);

  useEffect(() => {
    if (session || logical) return undefined;
    let cancelled = false;
    const virtualText = readBrowserDevVirtualTextDocument(document.path);
    void (virtualText === null ? readStructureText(document.path) : Promise.resolve(virtualText))
      .then((text) => { if (!cancelled) setFileText(text); })
      .catch((error) => { if (!cancelled) setSourceError({ message: error instanceof Error ? error.message : String(error), needsReferencePoint: false }); });
    return () => { cancelled = true; };
  }, [document.path, Boolean(session), Boolean(logical)]);

  const sourceText = session?.content ?? logical?.text ?? fileText;
  useEffect(() => {
    const sameSource = modelLogical.current === logical && modelRuntime.current === runtimeScope;
    if (sourceText === null || (sameSource && (sourceText === written.current || opening.current))) return;
    if (sameSource && sourceText === baseText.current && written.current === null && editorRef.current) return;
    const read = {}; modelRead.current = read; modelLogical.current = logical; modelRuntime.current = runtimeScope;
    lifetime.current++; optimizeJob.current?.abort();
    setEditor(null); setSourceError(null);
    if (session?.previewState && session.previewState !== "current") return;
    return observeGeometryBinding(document, actions.runStructureViewerAction, () => modelRead.current === read && logicalSourceFor(document.id) === logical,
      (binding) => {
        if (modelRead.current !== read) return;
        if (binding.text !== (logical ? sourceText : rendererXyzText(sourceText))) throw new Error("The scene changed. Read the current source before editing Geometry.");
        const base = geometryBase(binding.text);
        baseText.current = sourceText; written.current = null;
        setFrozen(new Set()); setLocked(new Set());
        setEditor({ binding, sourceText, base, frame: base, rows: base.rows, history: [] });
        setSourceError(null); setEditError(null);
      }, (error) => {
        if (modelRead.current !== read) return;
        setEditor(null);
        setSourceError({ message: error instanceof Error ? error.message : String(error),
          needsReferencePoint: NEEDS_REFERENCE_POINT.has((error as { code?: string } | null)?.code ?? "") });
      });
  }, [sourceText, logical, session?.previewState, runtimeScope]);

  if (sourceError) {
    const convertible = sourceError.needsReferencePoint && convert && convert.text === sourceText;
    const run = () => {
      try { convert?.run(); } catch (error) { setSourceError({ message: error instanceof Error ? error.message : String(error), needsReferencePoint: false }); }
    };
    return (
      <div className="dock-content dock-content-empty">
        <PanelEmptyState icon={<FileBlank />} title="Internal coordinates unavailable"
          description={convertible ? "The first atoms are nearly collinear. A reference point can place the rest without changing the atom order." : sourceError.message}
          action={convertible ? { label: "Convert to internal coordinates", run } : undefined} />
      </div>
    );
  }
  editorRef.current = editor;
  if (!editor) return null;

  const snapshot = (): GeometryHistory => ({ rows: editor.rows, frame: editor.frame, optimization: editor.optimization, text: editor.sourceText });
  const apply = async (rows: ZmatrixRow[], history: GeometryHistory[], frame: GeometryBase = editor.frame, optimization?: OptimizationSummary, exactText?: string) => {
    if (applyingRef.current) return false;
    let text: string;
    try {
      text = exactText ?? ((!logical && editor.sourceText.startsWith("\uFEFF") ? "\uFEFF" : "") + geometryText(frame, rows));
    } catch (error) {
      live.cancel();
      setEditError(error instanceof Error ? error.message : String(error));
      return false;
    }
    applyingRef.current = true;
    setApplying(true);
    const currentLifetime = lifetime.current;
    const shownText = editor.binding.text;
    const runtimeText = logical ? text : rendererXyzText(text);
    let shown = false;
    try {
      if (sourceEditing && !session) {
        opening.current = true;
        try { await sourceEditing.beginEditing(document, "geometry", { geometryBinding: editor.binding }); } finally { opening.current = false; }
      }
      if (currentLifetime !== lifetime.current) return false;
      // Opening reports its own failure and resolves without a session.
      const started = sourceEditing ? sourceEditing.sessionForDocument(document) : null;
      if (sourceEditing && !started) throw new Error("The source could not be opened for editing.");
      if (started && (logical ? started.content : rendererXyzText(started.content)) !== shownText) throw new Error("The source changed. Try the edit again.");
      await live.commit(runtimeText, shownText);
      shown = true;
      if (currentLifetime !== lifetime.current) return false;
      const latest = sourceEditing?.sessionForDocument(document) ?? null;
      if (started && latest && latest.content !== started.content) {
        // The source moved on while the scene took this edit: keep it and show it again.
        const latestText = logical ? latest.content : rendererXyzText(latest.content);
        void live.commit(latestText, latestText).catch(() => {});
        return false;
      }
      const previousWritten = written.current;
      written.current = text;
      try {
        sourceEditing?.updateDraft(document, text, { previewApplied: true });
        if (sourceEditing && sourceEditing.sessionForDocument(document)?.content !== text) throw new Error("The source did not take this edit.");
      } catch (error) { written.current = previousWritten; throw error; }
      setEditError(null);
      written.current = text;
      setEditor({ ...editor, binding: { ...editor.binding, text: runtimeText }, sourceText: text, rows, frame, history, optimization });
      return true;
    } catch (error) {
      if (currentLifetime !== lifetime.current) return false;
      if (shown) void live.commit(shownText, shownText).catch(() => {});
      else live.cancel();
      setEditError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      applyingRef.current = false;
      if (currentLifetime === lifetime.current) setApplying(false);
    }
  };
  const previewEdit = (atom: number, slot: number, value: number) => {
    if (applyingRef.current) return;
    try {
      live.preview(geometryText(editor.frame, withInternalCoordinate(editor.rows, atom, slot, value)), editor.binding.text);
      setEditError(null);
    } catch (error) {
      live.cancel();
      setEditError(error instanceof Error ? error.message : String(error));
    }
  };
  const edit = (atom: number, slot: number, value: number) => (
    apply(withInternalCoordinate(editor.rows, atom, slot, value), [...editor.history, snapshot()].slice(-HISTORY_LIMIT))
  );
  const undo = () => {
    const previous = editor.history.at(-1);
    if (previous) void apply(previous.rows, editor.history.slice(0, -1), previous.frame, previous.optimization, previous.text);
  };
  const constraints = geometryConstraints(editor.rows, frozen, locked);
  // MMFF94 minimization of the current draft. The result is one undoable edit;
  // it is dropped if the source or the coordinates change while it runs.
  const optimize = async (method: MinimizerMethod | undefined, forceField: MolecularForceField) => {
    optimizeJob.current?.abort();
    const controller = new AbortController();
    optimizeJob.current = controller;
    const started = editor;
    const currentLifetime = lifetime.current;
    setOptimizing(true);
    setEditError(null);
    try {
      const text = geometryText(started.frame, started.rows);
      const molecule = await runChemistryTask({ action: "parse", source: text, format: "xyz" }, { signal: controller.signal });
      const result = await runChemistryTask({ action: "optimize", molecule, options: { constraints, forceField, ...(method ? { method } : {}) } }, { signal: controller.signal, timeoutMs: 300_000 });
      if (controller.signal.aborted || currentLifetime !== lifetime.current || editorRef.current !== started) return;
      const positions = result.molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]);
      if (positions.length !== started.rows.length || result.molecule.atoms.some((atom, index) => atom.element !== started.rows[index].element)) {
        throw new Error("The optimized structure does not match the edited atoms.");
      }
      const residuals = result.constraintResiduals;
      const largest = (unit: "angstrom" | "degrees") => Math.max(0, ...residuals.filter((item) => item.unit === unit).map((item) => Math.abs(item.error)));
      // The optimized Cartesian geometry becomes the frame; the rows keep their reference atoms.
      const rows = rowsAt(started.rows, positions);
      const frame = { ...geometryBase(textAt(started.frame, positions)), rows };
      await apply(rows, [...started.history, snapshot()].slice(-HISTORY_LIMIT), frame, {
        forceField: result.forceField ?? forceField, initialEnergy: result.initialEnergy, energy: result.energy, converged: result.converged,
        residual: residuals.length ? { distance: largest("angstrom"), angle: largest("degrees") } : null,
      });
    } catch (error) {
      if (!isAbortError(error) && !controller.signal.aborted && currentLifetime === lifetime.current) setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      if (optimizeJob.current === controller) { optimizeJob.current = null; setOptimizing(false); }
    }
  };
  const cancelOptimize = () => { optimizeJob.current?.abort(); optimizeJob.current = null; setOptimizing(false); };
  const exportInput = () => {
    try {
      const { atoms } = parseXyz(geometryText(editor.frame, editor.rows));
      openWorkbenchDialog({ kind: "input", document, atoms, constraints: constraints.map(({ kind, atoms: indices }) => ({ kind, atoms: indices })) });
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  };
  // The current geometry as the Z-matrix export writes it (a reference point added when needed).
  const copyZmatrix = () => {
    try {
      void navigator.clipboard?.writeText(formatZmatrixDocument(zmatrixDocumentFromAtoms(parseXyzAtoms(geometryText(editor.frame, editor.rows)))));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  };
  const toggleFrozen = (atom: number) => setFrozen((current) => {
    const next = new Set(current);
    if (!next.delete(atom)) next.add(atom);
    return next;
  });
  const toggleLocked = (atom: number, slot: number) => setLocked((current) => {
    const next = new Set(current);
    const key = `${atom}:${slot}`;
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const clearSelection = () => actions.runStructureViewerAction(document, {
    type: "clear_selection", label: "Clear selection", notify: false,
  });
  const clearPreview = () => {
    if (!previewKey.current) return;
    previewKey.current = "";
    previewSender.current(document, { type: "preview_geometry", label: "Geometry preview", atoms: [], notify: false });
  };
  const preview = (target: EventTarget) => {
    const element = target instanceof Element ? target : null;
    const row = element?.closest<HTMLElement>("[data-geometry-atom]");
    if (!row) { clearPreview(); return; }
    const atom = Number(row.dataset.geometryAtom);
    const slotValue = element?.closest<HTMLElement>("[data-geometry-slot]")?.dataset.geometrySlot;
    const slot = slotValue === undefined ? null : Number(slotValue);
    const key = `${atom}:${slot}`;
    if (previewKey.current === key) return;
    previewKey.current = key;
    previewSender.current(document, {
      type: "preview_geometry", label: atomLabel(editor.rows, atom), notify: false,
      atoms: slot === null ? [atom] : [atom, ...editor.rows[atom].refs.slice(0, slot + 1)],
      kind: slot === null ? undefined : INTERNAL_COORDINATE_KINDS[slot],
    });
  };

  const optimization = editor.optimization;
  return (
    <div className="dock-content geometry-panel">
      <div className="geometry-panel-toolbar">
        <IconAction label="Undo" disabled={applying || editor.history.length === 0} onClick={undo}><Undo aria-hidden /></IconAction>
        <IconAction label="Copy Z-matrix" onClick={copyZmatrix}><Copy aria-hidden /></IconAction>
        <IconAction label="Export input file" onClick={exportInput}><FileCode aria-hidden /></IconAction>
        {optimizing ? (
          <>
            <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Optimizing</span>
            <Button type="button" variant="ghost" size="xs" onClick={cancelOptimize}>Cancel</Button>
          </>
        ) : (
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <span><OptimizeButton atomCount={editor.rows.length} size="xs" variant="secondary" disabled={applying} onOptimize={(method, forceField) => void optimize(method, forceField)} /></span>
          </TooltipTrigger><TooltipContent>{constraints.length ? `Optimize with ${constraints.length} constraint${constraints.length === 1 ? "" : "s"}` : "Optimize geometry"}</TooltipContent></Tooltip></TooltipProvider>
        )}
        {session?.dirty ? (
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <span className="ml-auto">
              <Button type="button" variant="secondary" size="xs" disabled={applying || Boolean(session.saveDisabledReason) || session.saving}
                onClick={() => void sourceEditing?.save(document)}>{session.saveLabel ?? "Save"}</Button>
            </span>
          </TooltipTrigger>{session.saveDisabledReason ? <TooltipContent>{session.saveDisabledReason}</TooltipContent> : null}</Tooltip></TooltipProvider>
        ) : null}
      </div>
      {editError ? <p role="alert" className="geometry-panel-error">{editError}</p> : null}
      {optimization ? (
        <p className="geometry-panel-result" role="status">
          {optimization.forceField ?? "MMFF94"} {optimization.initialEnergy.toFixed(2)} → {optimization.energy.toFixed(2)} kcal/mol
          {optimization.residual ? ` · residual ${optimization.residual.distance.toFixed(3)} Å, ${optimization.residual.angle.toFixed(2)}°` : ""}
          {" · "}<span data-status={optimization.converged ? "success" : "failure"} className="workbench-value">{optimization.converged ? "Converged" : "Not converged"}</span>
        </p>
      ) : null}
      <table className="geometry-table"
        onPointerDownCapture={clearSelection}
        onPointerOver={(event) => preview(event.target)} onPointerLeave={clearPreview}
        onFocusCapture={(event) => preview(event.target)}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) clearPreview(); }}>
        <thead>
          <tr>
            <th scope="col">Atom</th>
            {INTERNAL_COORDINATE_KINDS.map((kind) => <th key={kind} scope="col">{COLUMN_LABELS[kind]}, {internalCoordinateUnit(kind)}</th>)}
          </tr>
        </thead>
        <tbody onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('input, [role="spinbutton"]')) return;
          clearPreview();
          clearSelection();
        }}>
          {editor.rows.map((row, atom) => (
            <tr key={atom} data-geometry-atom={atom}>
              <th scope="row">
                <span className="geometry-atom">
                  {atomLabel(editor.rows, atom)}
                  <ConstraintToggle label={`Freeze ${atomLabel(editor.rows, atom)}`} active={frozen.has(atom)} disabled={applying || optimizing} onToggle={() => toggleFrozen(atom)} />
                </span>
              </th>
              {INTERNAL_COORDINATE_KINDS.map((kind, slot) => (
                <td key={kind} data-geometry-slot={slot < row.values.length ? slot : undefined}>
                  {slot < row.values.length ? (
                    <InternalCoordinateInput
                      disabled={applying || optimizing}
                      locked={locked.has(`${atom}:${slot}`)}
                      onToggleLock={() => toggleLocked(atom, slot)}
                      kind={kind}
                      value={row.values[slot]}
                      reference={atomLabel(editor.rows, row.refs[slot])}
                      label={`${COLUMN_LABELS[kind]} of ${atomLabel(editor.rows, atom)}`}
                      onPreview={(value) => previewEdit(atom, slot, value)}
                      onCancel={live.cancel}
                      onCommit={(value) => edit(atom, slot, value)}
                    />
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function atomLabel(rows: ZmatrixRow[], atom: number) {
  return `${rows[atom].element}${atom + 1}`;
}
