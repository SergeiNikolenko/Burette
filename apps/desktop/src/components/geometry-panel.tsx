import { useEffect, useMemo, useRef, useState } from "react";
import "./workbench/workbench-layout.css";
import "./workbench/geometry.css";
import { Button } from "./ui/button";
import { IconAction, InternalCoordinateInput } from "./workbench/geometry-fields";
import { ArrowCurvedRight, CompareArrows, Copy, Download, FileBlank, FileCode, Undo } from "./ui/app-icons";
import { measureGeometry } from "../../../../scripts/molecular-geometry.js";
import { readCoordinateInterchange, writeCoordinateInterchange } from "../../../../scripts/coordinate-interchange.mjs";
import { runChemistryTask } from "../lib/molecular-workbench/compute-client";
import type { GeometryConstraint } from "../lib/molecular-workbench/chemistry";
import type { EnergyModelChoice } from "../lib/molecular-workbench/energy-models";
import { energyModelName } from "../lib/molecular-workbench/external-energy-models";
import { optimizeWithEnergyModel } from "../lib/molecular-workbench/optimize-with-model";
import { optimizationRun, optimizerSettings, optimizerTolerances } from "../lib/workbench/optimizer-settings";
import { useOptimizationCommandHandler, type OptimizationCommand } from "../lib/workbench/optimization-commands";
import { parseXyz } from "../lib/molecular-workbench/xyz";
import { openWorkbenchDialog } from "../lib/workbench/dialog-store";
import { isAbortError } from "../lib/viewer-errors";
import { PanelEmptyState } from "./ui/panel-empty-state";
import { ConstraintToggle } from "./workbench/constraint-toggle";
import { ConstraintResiduals, OpenStepsButton, OptimizeButton, OptimizingStatus, optimizerLabel, useEnergyCalculation } from "./workbench/optimize-button";
import { useViewerAtomSelection } from "../lib/workbench/selection";
import { optimizationUnavailable } from "../lib/molecular-workbench/optimization";
import { resolveConstraints, type ConstraintResidual, type OptimizationMethod, type OptimizationProgress, type OptimizationResult } from "../lib/molecular-workbench/optimization";
import { fileStem } from "../lib/workbench/formats";
import { downloadTextFile } from "../lib/file-export";
import { consumeGeometryFocus, focusCellSelector, focusNoun, measurementCell, useGeometryFocusRequest } from "../lib/workbench/geometry-focus";
import { CoordinateEditor } from "./workbench/coordinate-editor";
import { SegmentedControl, SegmentedControlItem } from "./ui/segmented-control";
import type { MolecularAtom, Vec3 } from "../lib/molecular-workbench/types";
import { useAutoOptimize } from "./workbench/auto-optimize";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { useSourceEditing } from "../lib/source-editing/context";
import { captureLogicalSourceOwner } from "../lib/science-session/state";
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

type OptimizationSummary = Pick<OptimizationResult, "forceField" | "method" | "initialEnergy" | "energy" | "converged" | "iterations"> & { residuals: ConstraintResidual[] };
// Only the latest run keeps its step frames; Undo history keeps summaries, not trajectories.
type OptimizationSteps = { summary: OptimizationSummary; frames: OptimizationResult["frames"] };
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
type Editor = GeometryState & { binding: GeometryBinding; sourceText: string; base: GeometryBase; history: GeometryHistory[]; future: GeometryHistory[] };

// Panel changes retain the bounded edit history, never a renderer binding. A fresh
// source session or source replacement cannot borrow a previous document's history.
const panelHistories = new WeakMap<ViewerDocument, {
  sessionId: string; runtimePath: ViewerDocument["runtimePath"]; openClaimId: ViewerDocument["openClaimId"];
  sourceOwner: () => boolean; state: Omit<Editor, "binding">;
}>();

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
  const [progress, setProgress] = useState<OptimizationProgress | null>(null);
  const [steps, setSteps] = useState<OptimizationSteps | null>(null);
  const [view, setView] = useState<"internal" | "cartesian">("internal");
  const table = useRef<HTMLTableElement | null>(null);
  const focusRequest = useGeometryFocusRequest(document.id);
  const handledFocus = useRef(0);
  useEffect(() => {
    if (!focusRequest || !editor || handledFocus.current === focusRequest.id) return;
    handledFocus.current = focusRequest.id;
    consumeGeometryFocus(focusRequest.id);
    const cell = measurementCell(editor.rows, focusRequest.atoms);
    if (!cell) {
      setEditError(`This ${focusNoun(focusRequest.atoms)} is not a Geometry row.`);
      return;
    }
    setEditError(null);
    setView("internal");
    // The table renders after switching back from the Cartesian view.
    requestAnimationFrame(() => {
      const field = table.current?.querySelector<HTMLElement>(focusCellSelector(cell, 'input, [role="spinbutton"]'));
      field?.scrollIntoView({ block: "nearest" });
      field?.focus();
    });
  }, [focusRequest, editor]);
  const optimizeJob = useRef<AbortController | null>(null);
  useEffect(() => () => optimizeJob.current?.abort(), [document.id, document.path]);
  const lifetime = useRef(0);
  useEffect(() => { lifetime.current++; return () => { lifetime.current++; }; }, [document.id, document.path]);
  const live = useGeometryLivePreview(document, editor?.binding ?? null, actions.runStructureViewerAction,
    error => setEditError(error instanceof Error ? error.message : String(error)));
  const [configuring, setConfiguring] = useState(false);
  const energy = useEnergyCalculation(editor?.frame);
  const auto = useAutoOptimize(document, editor?.binding ?? null, actions.runStructureViewerAction);
  // The geometry Auto Optimize started from; any other change to the editor ends the session.
  const autoBase = useRef<Editor | null>(null);
  useEffect(() => {
    if (autoBase.current && autoBase.current !== editor) { autoBase.current = null; auto.stop(); }
  }, [editor]);
  const viewerSelection = useViewerAtomSelection(document.id);
  // Optimize Geometry, Calculate Energy and the other Calculate commands from menus and the palette.
  const command = useRef<(command: OptimizationCommand) => void>(() => {});
  useOptimizationCommandHandler(document.id, Boolean(editor), (name) => command.current(name));
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
        const saved = panelHistories.get(document);
        const currentSession = sourceEditing?.sessionForDocument(document);
        const retained = saved && saved.sessionId === currentSession?.sessionId && saved.state.sourceText === sourceText
          && saved.runtimePath === document.runtimePath && saved.openClaimId === document.openClaimId && saved.sourceOwner();
        if (!retained) panelHistories.delete(document);
        setEditor(retained ? { ...saved.state, binding } : { binding, sourceText, base, frame: base, rows: base.rows, history: [], future: [] });
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
  // A new edit clears Redo; Undo and Redo pass the stacks they leave behind.
  const apply = async (rows: ZmatrixRow[], history: GeometryHistory[], frame: GeometryBase = editor.frame, optimization?: OptimizationSummary, exactText?: string,
    future: GeometryHistory[] = []) => {
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
    const sourceOwner = captureLogicalSourceOwner(document.id);
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
        sourceEditing?.updateDraft(document, text, { previewApplied: true, geometryBinding: editor.binding });
        if (sourceEditing && sourceEditing.sessionForDocument(document)?.content !== text) throw new Error("The source did not take this edit.");
      } catch (error) { written.current = previousWritten; throw error; }
      setEditError(null);
      written.current = text;
      const state = { base: editor.base, sourceText: text, rows, frame, history, future, optimization };
      setEditor({ ...state, binding: { ...editor.binding, text: runtimeText } });
      const committedSession = sourceEditing?.sessionForDocument(document);
      if (committedSession?.content === text && sourceOwner()) panelHistories.set(document, {
        sessionId: committedSession.sessionId, runtimePath: document.runtimePath, openClaimId: document.openClaimId,
        sourceOwner, state,
      });
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
    if (previous) void apply(previous.rows, editor.history.slice(0, -1), previous.frame, previous.optimization, previous.text, [...editor.future, snapshot()]);
  };
  const redo = () => {
    const next = editor.future.at(-1);
    if (next) void apply(next.rows, [...editor.history, snapshot()].slice(-HISTORY_LIMIT), next.frame, next.optimization, next.text, editor.future.slice(0, -1));
  };
  const constraints = geometryConstraints(editor.rows, frozen, locked);
  // MMFF94 minimization of the current draft. The result is one undoable edit;
  // it is dropped if the source or the coordinates change while it runs.
  // Constraints that are undefined on the current geometry are refused before any work starts.
  let constraintError: string | null = null;
  if (constraints.length) {
    try { resolveConstraints(parseXyz(geometryText(editor.frame, editor.rows)).atoms, constraints); }
    catch (error) { constraintError = error instanceof Error ? error.message : String(error); }
  }
  const optimize = async (method: OptimizationMethod, choice: EnergyModelChoice, maxIterations: number) => {
    optimizeJob.current?.abort();
    const controller = new AbortController();
    optimizeJob.current = controller;
    const started = editor;
    const currentLifetime = lifetime.current;
    setOptimizing(true);
    setProgress(null);
    setEditError(null);
    try {
      const text = geometryText(started.frame, started.rows);
      const molecule = await runChemistryTask({ action: "parse", source: text, format: "xyz" }, { signal: controller.signal });
      const result = await optimizeWithEnergyModel(molecule, choice, { constraints, method, maxIterations, ...optimizerTolerances() }, {
        signal: controller.signal, onProgress: (step) => {
          if (optimizeJob.current !== controller) return;
          setProgress(step);
          // The view follows the run; Cancel or a failure restores the start.
          if (step.atoms) live.preview(textAt(started.frame, step.atoms.map((atom) => [atom.x, atom.y, atom.z])), started.binding.text);
        },
      });
      if (controller.signal.aborted || currentLifetime !== lifetime.current || editorRef.current !== started) return;
      const positions = result.molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]);
      if (positions.length !== started.rows.length || result.molecule.atoms.some((atom, index) => atom.element !== started.rows[index].element)) {
        throw new Error("The optimized structure does not match the edited atoms.");
      }
      // The optimized Cartesian geometry becomes the frame; the rows keep their reference atoms.
      const rows = rowsAt(started.rows, positions);
      const frame = { ...geometryBase(textAt(started.frame, positions)), rows };
      const summary: OptimizationSummary = { forceField: result.forceField, method: result.method, initialEnergy: result.initialEnergy, energy: result.energy,
        converged: result.converged, iterations: result.iterations, residuals: result.constraintResiduals };
      if (await apply(rows, [...started.history, snapshot()].slice(-HISTORY_LIMIT), frame, summary) && result.frameSampling === "steps") setSteps({ summary, frames: result.frames });
    } catch (error) {
      if (optimizeJob.current === controller) live.cancel();
      if (!isAbortError(error) && !controller.signal.aborted && currentLifetime === lifetime.current) setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      if (optimizeJob.current === controller) { optimizeJob.current = null; setOptimizing(false); }
    }
  };
  const cancelOptimize = () => { optimizeJob.current?.abort(); optimizeJob.current = null; setOptimizing(false); live.cancel(); };
  const positionsOf = (atoms: MolecularAtom[]): Vec3[] => atoms.map((atom) => [atom.x, atom.y, atom.z]);
  auto.handlers.current = {
    frame: (atoms) => { const base = autoBase.current; if (base) live.preview(textAt(base.frame, positionsOf(atoms)), base.binding.text); },
    finish: (atoms) => {
      const base = autoBase.current;
      autoBase.current = null;
      if (base !== editor) { live.cancel(); return; }
      const positions = positionsOf(atoms), rows = rowsAt(editor.rows, positions);
      void apply(rows, [...editor.history, snapshot()].slice(-HISTORY_LIMIT), { ...geometryBase(textAt(editor.frame, positions)), rows });
    },
    cancel: () => { autoBase.current = null; live.cancel(); },
  };
  // Avogadro's Auto Optimize is a toggle: the same command stops it and keeps the result.
  const toggleAutoOptimize = async () => {
    if (auto.running) { auto.stop(); return; }
    const blocked = optimizing || applying ? "Wait for the current edit to finish." : constraintError ?? optimizationUnavailable(editor.rows.length, constraints.length);
    if (blocked) { setEditError(blocked); return; }
    setEditError(null);
    const started = editor;
    try {
      const molecule = await runChemistryTask({ action: "parse", source: geometryText(started.frame, started.rows), format: "xyz" });
      if (editorRef.current !== started) return;
      autoBase.current = started;
      auto.start(molecule, constraints);
    } catch (error) { setEditError(error instanceof Error ? error.message : String(error)); }
  };
  command.current = (name) => {
    if (name === "configure") { setConfiguring(true); return; }
    if (name === "freeze" || name === "unfreeze") {
      const picked = viewerSelection && !viewerSelection.truncated ? viewerSelection.atoms.filter((atom) => atom < editor.rows.length) : [];
      if (!picked.length) { setEditError(`Select the atoms to ${name} in the 3D view.`); return; }
      setEditError(null);
      setFrozen((current) => { const next = new Set(current); for (const atom of picked) { if (name === "freeze") next.add(atom); else next.delete(atom); } return next; });
      return;
    }
    if (name === "calculate-energy") {
      void runChemistryTask({ action: "parse", source: geometryText(editor.frame, editor.rows), format: "xyz" }).then((molecule) => energy.calculate(molecule, editor.frame), (error) => setEditError(error instanceof Error ? error.message : String(error)));
      return;
    }
    if (name === "auto-optimize") { void toggleAutoOptimize(); return; }
    if (name !== "optimize") return;
    const blocked = optimizing || applying ? "Wait for the current edit to finish." : constraintError ?? optimizationUnavailable(editor.rows.length, constraints.length);
    if (blocked) { setEditError(blocked); return; }
    const run = optimizationRun(optimizerSettings(), editor.rows.map((row) => row.element), constraints.length > 0);
    void optimize(run.method, run.model, run.maxIterations);
  };
  // New positions for the same atoms from the coordinate editor: one undoable edit that keeps
  // unmoved atom lines verbatim. Its rows are measured afresh, as when the text is opened.
  const applyCoordinates = async (positions: Vec3[]) => {
    // The managed marker would keep describing the previous geometry.
    if (editor.sourceText.includes("BURETTE_INTERNAL_COORDINATES_V")) {
      setEditError("This structure keeps a Z-matrix definition. Edit its rows instead.");
      return false;
    }
    let body: string;
    let frame: GeometryBase;
    try {
      body = textAt(geometryBase(editor.binding.text), positions);
      frame = geometryBase(body);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
      return false;
    }
    const text = (!logical && editor.sourceText.startsWith("\uFEFF") ? "\uFEFF" : "") + body;
    return apply(frame.rows, [...editor.history, snapshot()].slice(-HISTORY_LIMIT), frame, undefined, text);
  };
  const exportInput = () => {
    try {
      const { atoms } = parseXyz(geometryText(editor.frame, editor.rows));
      openWorkbenchDialog({ kind: "input", document, atoms, constraints: constraints.map(({ kind, atoms: indices }) => ({ kind, atoms: indices })) });
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  };
  // The current geometry as the Z-matrix export writes it (a reference point added when needed).
  const copyZmatrix = async () => {
    try {
      const pair = readCoordinateInterchange(geometryText(editor.frame, editor.rows), "xyz");
      if (typeof navigator.clipboard?.writeText !== "function") throw new Error("Clipboard unavailable.");
      await navigator.clipboard.writeText(writeCoordinateInterchange(pair, "zmat", pair.comment));
      setEditError(null);
    } catch {
      setEditError("Could not copy the Z-matrix. Try again.");
    }
  };
  const exportZmatrix = () => {
    try {
      const pair = readCoordinateInterchange(geometryText(editor.frame, editor.rows), "xyz");
      downloadTextFile(`${fileStem(document.title)}.zmat`, writeCoordinateInterchange(pair, "zmat", pair.comment));
      setEditError(null);
    } catch {
      setEditError("Could not export the Z-matrix. Try again.");
    }
  };
  // Conversion reads the saved science, so it is offered while the panel shows that text.
  const convertible = convert !== null && convert.text === editor.sourceText;
  const convertToZmatrix = () => {
    try { convert?.run(); } catch (error) { setEditError(error instanceof Error ? error.message : String(error)); }
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
        <IconAction label="Redo" disabled={applying || editor.future.length === 0} onClick={redo}><ArrowCurvedRight aria-hidden /></IconAction>
        {convertible ? <IconAction label="Convert to Z-matrix" disabled={applying || optimizing} onClick={convertToZmatrix}><CompareArrows aria-hidden /></IconAction> : null}
        <IconAction label="Copy Z-matrix" onClick={copyZmatrix}><Copy aria-hidden /></IconAction>
        <IconAction label="Export Z-matrix" onClick={exportZmatrix}><Download aria-hidden /></IconAction>
        <IconAction label="Export input file" onClick={exportInput}><FileCode aria-hidden /></IconAction>
        {auto.status ?? (optimizing ? (
          <>
            <OptimizingStatus progress={progress} />
            <Button type="button" variant="ghost" size="xs" onClick={cancelOptimize}>Cancel</Button>
          </>
        ) : (
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <span><OptimizeButton atomCount={editor.rows.length} elements={editor.rows.map((row) => row.element)} constraintCount={constraints.length} unavailableReason={constraintError} size="xs" variant="secondary" disabled={applying} configureOpen={configuring} onConfigureOpenChange={setConfiguring} onOptimize={(method, forceField, maxIterations) => void optimize(method, forceField, maxIterations)} onAutoOptimize={() => void toggleAutoOptimize()} /></span>
          </TooltipTrigger><TooltipContent>{constraints.length ? `Optimize with ${constraints.length} constraint${constraints.length === 1 ? "" : "s"}` : "Optimize geometry"}</TooltipContent></Tooltip></TooltipProvider>
        ))}
        {session?.dirty ? (
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <span className="ml-auto">
              <Button type="button" variant="secondary" size="xs" disabled={applying || Boolean(session.saveDisabledReason) || session.saving}
                onClick={() => void sourceEditing?.save(document)}>{session.saveLabel ?? "Save"}</Button>
            </span>
          </TooltipTrigger>{session.saveDisabledReason ? <TooltipContent>{session.saveDisabledReason}</TooltipContent> : null}</Tooltip></TooltipProvider>
        ) : null}
      </div>
      {editError ?? auto.error ? <p role="alert" className="geometry-panel-error">{editError ?? auto.error}</p> : null}
      {energy.line}
      {optimization ? (
        <div className="geometry-panel-result" role="status">
          <p>
            {energyModelName(optimization.forceField ?? "MMFF94")}, {optimizerLabel(optimization.method)} {optimization.initialEnergy.toFixed(2)} → {optimization.energy.toFixed(2)} kcal/mol
            {optimization.iterations === null ? "" : `, ${optimization.iterations} step${optimization.iterations === 1 ? "" : "s"}`}
            {" · "}<span data-status={optimization.converged ? "success" : "failure"} className="workbench-value">{optimization.converged ? "Converged" : "Not converged"}</span>
            {steps?.summary === optimization ? <OpenStepsButton actions={actions} document={document} frames={steps.frames} /> : null}
          </p>
          <ConstraintResiduals residuals={optimization.residuals} atomLabel={(atom) => atomLabel(editor.rows, atom)} />
        </div>
      ) : null}
      <SegmentedControl aria-label="Geometry view" value={view} onValueChange={(value) => setView(value as "internal" | "cartesian")}>
        <SegmentedControlItem value="internal">Internal</SegmentedControlItem>
        <SegmentedControlItem value="cartesian">Cartesian</SegmentedControlItem>
      </SegmentedControl>
      {view === "cartesian" ? (
        <CoordinateEditor atoms={parseXyz(editor.binding.text).atoms} revision={editor.binding.text} disabled={applying || optimizing} onApply={applyCoordinates} />
      ) : <table ref={table} className="geometry-table"
        onPointerDownCapture={clearSelection}
        onPointerOver={(event) => preview(event.target)} onPointerLeave={clearPreview}
        onFocusCapture={(event) => preview(event.target)}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) clearPreview(); }}>
        <thead>
          <tr>
            <th scope="col">Atom</th>
            {INTERNAL_COORDINATE_KINDS.map((kind) => <th key={kind} scope="col">{`${COLUMN_LABELS[kind]}, ${internalCoordinateUnit(kind)}`}</th>)}
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
      </table>}
    </div>
  );
}

function atomLabel(rows: ZmatrixRow[], atom: number) {
  return `${rows[atom].element}${atom + 1}`;
}
