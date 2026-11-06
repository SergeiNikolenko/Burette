import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { GraphEdit, GraphEditResult } from "../../lib/molecular-workbench/graph-edit";
import { moveAtomOrder } from "../../lib/molecular-workbench/atom-order";
import type { MolecularAtom, Vec3 } from "../../lib/molecular-workbench/types";
import type { GeometryBinding } from "../../lib/geometry-binding";
import { useGeometryBinding } from "../../hooks/use-geometry-binding";
import { useGeometryLivePreview } from "../../hooks/use-geometry-live-preview";
import { flatDepiction, resolveConstraints, type GeometryConstraint, type OptimizationMethod } from "../../lib/molecular-workbench/optimization";
import type { EnergyModelChoice } from "../../lib/molecular-workbench/energy-models";
import { energyModelName } from "../../lib/molecular-workbench/external-energy-models";
import { useViewerAtomSelection } from "../../lib/workbench/selection";
import { useLogicalSource } from "../../lib/science-session/state";
import { useWorkspaceMenus } from "../workspace-menus";
import { useSourceEditing } from "../../lib/source-editing/context";
import type { ShellActions } from "../types";
import type { ViewerDocument } from "../../types";
import { ShortcutTooltip } from "../shortcut-tooltip";
import { ArrowCurvedRight, DotsHorizontal, FileBlank, Plus, Undo } from "../ui/app-icons";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { PanelEmptyState } from "../ui/panel-empty-state";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import { CoordinateEditor } from "./coordinate-editor";
import { GraphMetadataFields } from "./graph-metadata-fields";
import { ConstraintResiduals, OpenStepsButton, OptimizeButton, OptimizingStatus, useEnergyCalculation } from "./optimize-button";
import { useOptimizationCommandHandler, type OptimizationCommand } from "../../lib/workbench/optimization-commands";
import { useAutoOptimize } from "./auto-optimize";
import { optimizationRun, optimizerSettings } from "../../lib/workbench/optimizer-settings";
import { optimizationUnavailable } from "../../lib/molecular-workbench/optimization";
import { ConstraintEditor } from "./structure-edit/constraint-editor";
import { useGraphDraft, type GraphOutcome, type GraphSnapshot } from "./use-graph-draft";
import { SelectionEditor } from "./structure-edit/selection-editor";
import { AtomTable } from "./structure-edit/atom-table";
import { BondTable } from "./structure-edit/bond-table";
import { label, normalizeElement } from "./structure-edit/values";
import { InsertFragmentDialog } from "./structure-edit/insert-fragment-dialog";
import { AdjustPhDialog } from "./structure-edit/adjust-ph-dialog";
import type { FragmentSource } from "../../lib/molecular-workbench/fragment-source";
import "./workbench-layout.css";
import "./structure-edit/structure-edit.css";

// Atom indices mean something only in the structure they were picked in. Every
// snapshot transition (an edit, Undo, Redo, a reload) replaces the structure
// object, so a selection of another structure reads as empty in the same render.
type Selection = { atoms: number[]; from: "panel" | "viewer"; structure: GraphEditResult | null };
const NO_SELECTION: Selection = { atoms: [], from: "panel", structure: null };
// Constraints are held for the structure they were set on and follow its atoms through
// edits and optimizations; Undo, Redo and renumbering operations start without them.
type Held = { constraints: GeometryConstraint[]; structure: GraphEditResult | null };
const NOT_HELD: Held = { constraints: [], structure: null };

/** Constraints after an edit: those whose atoms all survived it, at their new positions. */
function mapConstraints(constraints: GeometryConstraint[], structure: GraphEditResult) {
  return constraints.flatMap((constraint) => {
    const atoms = constraint.atoms.map((atom) => structure.sourceAtomIndices.indexOf(atom));
    return atoms.every((atom) => atom >= 0) ? [{ ...constraint, atoms }] : [];
  });
}

function selectedAtoms(selection: Selection, structure: GraphEditResult | undefined) {
  if (!structure || selection.structure !== structure) return [];
  return selection.atoms.filter((atom) => Number.isInteger(atom) && atom >= 0 && atom < structure.atoms.length);
}

const NEW_BOND_LENGTH = 1.5;
const VIEWER_SELECTION_LIMIT = 96;
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);

// Field drafts restart for every snapshot, including the ones Undo and Redo return to.
const snapshotIds = new WeakMap<GraphSnapshot, number>();
let nextSnapshotId = 0;
function snapshotId(snapshot: GraphSnapshot) {
  let id = snapshotIds.get(snapshot);
  if (id === undefined) { id = ++nextSnapshotId; snapshotIds.set(snapshot, id); }
  return id;
}

/** Selection after an edit: atoms that survived it, at their new positions. */
function mapSelection(selected: number[], structure: GraphEditResult) {
  const kept = new Set(selected);
  return structure.sourceAtomIndices.flatMap((source, index) => (source >= 0 && kept.has(source) ? [index] : []));
}

/** A position for a new atom: away from its bonded neighbours, or beside the whole structure. */
function newAtomPosition(structure: GraphEditResult, anchor: number | null): Vec3 {
  const atoms = structure.atoms;
  if (anchor !== null) {
    const origin = atoms[anchor];
    const neighbours = structure.bonds.flatMap((bond) => (bond.a === anchor ? [bond.b] : bond.b === anchor ? [bond.a] : []));
    const reference = neighbours.length ? neighbours.map((index) => atoms[index]) : atoms.filter((_, index) => index !== anchor);
    const centre = reference.length
      ? reference.reduce((sum, atom) => [sum[0] + atom.x / reference.length, sum[1] + atom.y / reference.length, sum[2] + atom.z / reference.length], [0, 0, 0])
      : [origin.x - 1, origin.y, origin.z];
    let direction = [origin.x - centre[0], origin.y - centre[1], origin.z - centre[2]];
    const length = Math.hypot(...direction);
    direction = length > 1e-3 ? direction.map((value) => value / length) : [1, 0, 0];
    return [origin.x + direction[0] * NEW_BOND_LENGTH, origin.y + direction[1] * NEW_BOND_LENGTH, origin.z + direction[2] * NEW_BOND_LENGTH];
  }
  const maxX = Math.max(...atoms.map((atom) => atom.x));
  const mean = (axis: "y" | "z") => atoms.reduce((sum, atom) => sum + atom[axis], 0) / atoms.length;
  return [maxX + 2 * NEW_BOND_LENGTH, mean("y"), mean("z")];
}

/** The scene's Geometry rows are the structure's atoms in source order. */
function sameAtoms(binding: GeometryBinding, atoms: readonly MolecularAtom[]) {
  const rows = binding.text.split("\n").slice(2).filter((line) => line.trim());
  return rows.length === atoms.length && rows.every((line, index) => line.trim().split(/\s+/u)[0] === atoms[index].element);
}

/** The binding's XYZ with new coordinates for the same atoms. */
function xyzAt(binding: GeometryBinding, atoms: readonly MolecularAtom[]) {
  const [count, title] = binding.text.split("\n", 2);
  return [count, title, ...atoms.map((atom) => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`)].join("\n") + "\n";
}

export function StructureEditPanel({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  const sourceEditing = useSourceEditing();
  const logicalSource = useLogicalSource(document.id);
  const workspaceMenus = useWorkspaceMenus();
  const saveScene = logicalSource ? workspaceMenus.saveScene : undefined;
  const draft = useGraphDraft(document);
  const session = draft.session;
  const editor = draft.history;
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [held, setHeld] = useState<Held>(NOT_HELD);
  const [view, setView] = useState<"atoms" | "bonds" | "cartesian">("atoms");
  const [addElement, setAddElement] = useState("C");
  const [inputError, setInputError] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false), [adjustingPh, setAdjustingPh] = useState(false);
  const viewerSelection = useViewerAtomSelection(document.id);
  const send = useRef(actions.runStructureViewerAction);
  send.current = actions.runStructureViewerAction;
  const currentStructure = editor?.current.structure;
  const atoms = selectedAtoms(selection, currentStructure);
  const constraints = currentStructure && held.structure === currentStructure ? held.constraints : [];
  const [configuring, setConfiguring] = useState(false);
  const energy = useEnergyCalculation(currentStructure);
  // Optimize Geometry, Calculate Energy and the other Calculate commands from menus and the palette.
  const command = useRef<(command: OptimizationCommand) => void>(() => {});
  useOptimizationCommandHandler(document.id, Boolean(editor), (name) => command.current(name));
  // The snapshot Auto Optimize started from; any other change to the draft ends the session.
  const autoBase = useRef<GraphSnapshot | null>(null);
  // While Auto Optimize runs, its frames preview in the scene through a Geometry binding.
  const [autoScene, setAutoScene] = useState(false);
  const autoBinding = useGeometryBinding(document, actions.runStructureViewerAction, editor?.current ?? document,
    (binding) => Boolean(editor) && sameAtoms(binding, editor!.current.structure.atoms), autoScene).binding;
  const live = useGeometryLivePreview(document, autoBinding, actions.runStructureViewerAction,
    (caught) => setInputError(caught instanceof Error ? caught.message : String(caught)));
  const auto = useAutoOptimize(document, autoBinding, actions.runStructureViewerAction);
  useEffect(() => {
    if (autoBase.current && autoBase.current !== editor?.current) { autoBase.current = null; auto.stop(); }
  }, [editor?.current]);

  // A selection made in the 3D view replaces the panel's selection; clearing it in
  // the view clears it here too. Atoms picked in the panel stay picked.
  const loaded = Boolean(editor);
  useEffect(() => {
    if (!editor) return;
    const structure = editor.current.structure;
    if (!viewerSelection) {
      setSelection((current) => (current.from === "viewer" && current.structure === structure && current.atoms.length
        ? { atoms: [], from: "viewer", structure } : current));
      return;
    }
    setSelection({ atoms: viewerSelection.truncated ? [] : [...viewerSelection.atoms], from: "viewer", structure });
  }, [viewerSelection, loaded]);

  // Atoms picked in the panel are highlighted in the scene, also after a draft reloads it.
  const highlighted = selection.from === "panel" ? atoms.join(",") : "";
  useEffect(() => {
    if (!editor) return undefined;
    const atoms = highlighted ? highlighted.split(",").map(Number) : [];
    void send.current(document, { type: "preview_geometry", label: "Selected atoms", atoms, notify: false });
    return () => { if (atoms.length) void send.current(document, { type: "preview_geometry", label: "Selected atoms", atoms: [], notify: false }); };
  }, [highlighted, session?.sourcePreview, loaded]);

  if (!editor && draft.error) {
    return <div className="dock-content dock-content-empty"><PanelEmptyState icon={<FileBlank />} title="Atoms and bonds unavailable" description={draft.error} /></div>;
  }
  if (!editor) return <div className="dock-content workbench-panel"><span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Reading structure…</span></div>;

  const { structure, annotations, outcome } = editor.current;

  /** One user action (one or more graph edits) as one Undo step; the selection follows the atoms. */
  const apply = async (edits: GraphEdit[], select?: (result: GraphEditResult) => number[]) => {
    setInputError(null);
    const result = await draft.apply({ kind: "edits", edits });
    if (!result) return;
    setSelection((current) => ({
      atoms: current === selection && select ? select(result) : mapSelection(selectedAtoms(current, structure), result),
      from: "panel", structure: result,
    }));
    setHeld({ constraints: mapConstraints(constraints, result), structure: result });
  };
  // The same atoms at new positions keep their constraints.
  const keepConstraints = (result: GraphEditResult) => setHeld({ constraints, structure: result });
  let constraintError: string | null = null;
  if (constraints.length) {
    try { resolveConstraints(structure.atoms, constraints); }
    catch (caught) { constraintError = caught instanceof Error ? caught.message : String(caught); }
  }
  const optimize = async (operation: { method: OptimizationMethod; forceField: EnergyModelChoice; maxIterations: number }) => {
    setInputError(null);
    const result = await draft.apply({ kind: "optimize", ...operation, constraints });
    if (result) { setSelection((current) => ({ atoms: selectedAtoms(current, structure), from: current.from, structure: result })); keepConstraints(result); }
  };
  const freeze = (frozen: boolean) => {
    if (!atoms.length) { setInputError(`Select the atoms to ${frozen ? "freeze" : "unfreeze"}.`); return; }
    const kept = constraints.filter((item) => item.kind !== "freeze" || !atoms.includes(item.atoms[0]));
    setInputError(null);
    setHeld({ constraints: frozen ? [...kept, ...atoms.map((atom) => ({ kind: "freeze" as const, atoms: [atom] }))] : kept, structure });
  };
  command.current = (name) => {
    if (name === "configure") { setConfiguring(true); return; }
    if (name === "freeze" || name === "unfreeze") { freeze(name === "freeze"); return; }
    if (name === "calculate-energy") { void energy.calculate(structure); return; }
    if (name === "auto-optimize") { toggleAutoOptimize(); return; }
    if (name !== "optimize") return;
    const blocked = busy ? "Wait for the current edit to finish." : constraintError ?? optimizationUnavailable(structure.atoms.length, constraints.length);
    if (blocked) { setInputError(blocked); return; }
    const run = optimizationRun(optimizerSettings(), structure.atoms.map((atom) => atom.element), constraints.length > 0);
    void optimize({ method: run.method, forceField: run.model, maxIterations: run.maxIterations });
  };
  auto.handlers.current = {
    frame: (relaxed) => { if (autoBinding) live.preview(xyzAt(autoBinding, relaxed), autoBinding.text); },
    finish: (relaxed) => {
      const base = autoBase.current;
      autoBase.current = null;
      if (base !== editor.current) { live.cancel(); setAutoScene(false); return; }
      // The scene keeps the relaxed frame until the published draft reloads it.
      const shown = autoBinding ? live.commit(xyzAt(autoBinding, relaxed), autoBinding.text).catch(() => {}) : Promise.resolve();
      void shown.then(() => draft.apply({ kind: "positions", coordinates: relaxed.map((atom) => [atom.x, atom.y, atom.z]), from: base })).then((result) => {
        if (result) { setSelection((current) => ({ atoms: selectedAtoms(current, structure), from: current.from, structure: result })); keepConstraints(result); }
      }).finally(() => setAutoScene(false));
    },
    cancel: () => { autoBase.current = null; live.cancel(); setAutoScene(false); },
  };
  // Avogadro's Auto Optimize is a toggle: the same command stops it and keeps the result.
  const toggleAutoOptimize = () => {
    if (auto.running) { auto.stop(); return; }
    const blocked = busy ? "Wait for the current edit to finish." : constraintError ?? optimizationUnavailable(structure.atoms.length, constraints.length);
    if (blocked) { setInputError(blocked); return; }
    setInputError(null);
    autoBase.current = editor.current;
    setAutoScene(true);
    auto.start(structure, constraints);
  };
  // Adding or removing hydrogens (also when generating 3D coordinates) renumbers atoms, so the selection does not carry over.
  const renumbering = async (operation: { kind: "add-hydrogens" | "remove-hydrogens" | "prepare-3d" } | { kind: "protonate"; pH: number }) => {
    setInputError(null);
    if (await draft.apply(operation)) setSelection(NO_SELECTION);
  };

  // One fragment per Undo step; the inserted atoms become the selection.
  const insertFragment = async (fragment: FragmentSource) => {
    setInputError(null);
    const result = await draft.apply({ kind: "insert-fragment", fragment, target: atoms.length === 1 ? atoms[0] : null });
    if (result) setSelection({ atoms: result.sourceAtomIndices.flatMap((source, index) => source < 0 ? [index] : []), from: "panel", structure: result });
  };

  const addAtom = () => {
    const element = normalizeElement(addElement);
    if (!element) { setInputError("Enter an element symbol, such as C or Cl."); return; }
    const anchor = atoms.length === 1 ? atoms[0] : null;
    const index = structure.atoms.length;
    const edits: GraphEdit[] = [{ kind: "add-atom", element, position: newAtomPosition(structure, anchor) }];
    if (anchor !== null) edits.push({ kind: "set-bond", a: anchor, b: index, order: 1 });
    void apply(edits, () => [index]);
  };
  const deleteSelected = () => {
    if (atoms.length) void apply([{ kind: "delete-atoms", indices: atoms }], () => []);
  };
  const reorder = (atom: number, insertion: number) => {
    if (insertion === atom || insertion === atom + 1) return;
    const order = moveAtomOrder(structure.atoms.length, atom, insertion);
    void apply([{ kind: "reorder-atoms", order }], () => [order.indexOf(atom)]);
  };
  const move = (atom: number, offset: -1 | 1) => {
    const target = atom + offset;
    if (target >= 0 && target < structure.atoms.length) reorder(atom, offset < 0 ? target : target + 1);
  };

  const pick = (atom: number, event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey">) => {
    setSelection((current) => {
      const base = selectedAtoms(current, structure);
      if (event.shiftKey && base.length) {
        const from = base.at(-1)!;
        const range = Array.from({ length: Math.abs(atom - from) + 1 }, (_, step) => Math.min(from, atom) + step);
        return { atoms: [...new Set([...base, ...range])], from: "panel", structure };
      }
      if (event.metaKey || event.ctrlKey) {
        return { atoms: base.includes(atom) ? base.filter((item) => item !== atom) : [...base, atom], from: "panel", structure };
      }
      return { atoms: [atom], from: "panel", structure };
    });
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input, textarea, [role='spinbutton']")) return;
    if ((IS_MAC ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      void (event.shiftKey ? draft.redo() : draft.undo());
    } else if (!IS_MAC && event.ctrlKey && event.key.toLowerCase() === "y") {
      event.preventDefault();
      void draft.redo();
    }
  };

  const busy = draft.busy;
  const truncated = viewerSelection?.truncated && selection.from === "viewer";
  const error = inputError ?? auto.error ?? draft.error ?? session?.diagnostic ?? null;
  return (
    <div className="dock-content workbench-panel structure-edit-panel" onKeyDown={onPanelKeyDown}>
      <div className="workbench-toolbar">
        <ShortcutTooltip label="Undo" shortcut={IS_MAC ? "⌘Z" : "Ctrl+Z"}>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Undo" disabled={busy || !editor.undo.length} onClick={() => void draft.undo()}><Undo aria-hidden /></Button>
        </ShortcutTooltip>
        <ShortcutTooltip label="Redo" shortcut={IS_MAC ? "⇧⌘Z" : "Ctrl+Y"}>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Redo" disabled={busy || !editor.redo.length} onClick={() => void draft.redo()}><ArrowCurvedRight aria-hidden /></Button>
        </ShortcutTooltip>
        <form className="structure-edit-add" onSubmit={(event) => { event.preventDefault(); addAtom(); }}>
          <Input variant="compact" className="structure-edit-element" value={addElement} maxLength={3} spellCheck={false} autoComplete="off"
            aria-label="Element to add" onChange={(event) => setAddElement(event.target.value)} />
          <ShortcutTooltip label={atoms.length === 1 ? `Add atom bonded to ${label(structure, atoms[0])}` : "Add atom"}>
            <Button type="submit" variant="secondary" size="xs" disabled={busy}><Plus aria-hidden />Add</Button>
          </ShortcutTooltip>
        </form>
        <OptimizeButton atomCount={structure.atoms.length} elements={structure.atoms.map((atom) => atom.element)} constraintCount={constraints.length} unavailableReason={constraintError} size="xs" variant="secondary" disabled={busy}
          configureOpen={configuring} onConfigureOpenChange={setConfiguring}
          onOptimize={(method, forceField, maxIterations) => void optimize({ method, forceField, maxIterations })} onAutoOptimize={toggleAutoOptimize} />
        <DropdownMenu>
          <ShortcutTooltip label="More actions">
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="More actions" disabled={busy}><DotsHorizontal aria-hidden /></Button>
            </DropdownMenuTrigger>
          </ShortcutTooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setInserting(true)}>Insert fragment…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void renumbering({ kind: "add-hydrogens" })}>Add hydrogens</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void renumbering({ kind: "remove-hydrogens" })}>Remove hydrogens</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAdjustingPh(true)}>Adjust hydrogens for pH…</DropdownMenuItem>
            {flatDepiction(structure)
              ? <DropdownMenuItem onSelect={() => void renumbering({ kind: "prepare-3d" })}>Generate 3D coordinates</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {auto.status}
        {busy ? (
          <span className="workbench-status">
            {draft.progress ? <OptimizingStatus progress={draft.progress} /> : <span role="status"><Spinner aria-hidden className="size-3" /><span className="sr-only">Applying…</span></span>}
            <Button type="button" variant="ghost" size="xs" onClick={draft.cancel}>Cancel</Button>
          </span>
        ) : null}
        {session?.dirty ? (
          <ShortcutTooltip label={saveScene ? "Save scene" : session.saveDisabledReason ?? session.saveLabel ?? "Save"}>
            <span className="ml-auto">
              <Button type="button" variant="secondary" size="xs" disabled={busy || (!saveScene && Boolean(session.saveDisabledReason)) || session.saving}
                onClick={() => saveScene ? saveScene(document) : void sourceEditing?.save(document)}>{saveScene ? "Save scene" : session.saveLabel ?? "Save"}</Button>
            </span>
          </ShortcutTooltip>
        ) : null}
      </div>
      {error && !inserting ? <p role="alert" className="workbench-error">{error}</p> : null}
      <InsertFragmentDialog open={inserting} onOpenChange={setInserting} target={atoms.length === 1 ? label(structure, atoms[0]) : null}
        busy={busy} error={error} onInsert={fragment => void insertFragment(fragment)} />
      <AdjustPhDialog open={adjustingPh} onOpenChange={setAdjustingPh} onApply={pH => void renumbering({ kind: "protonate", pH })} />
      {energy.line}
      {outcome ? <OptimizationOutcome outcome={outcome} structure={structure} actions={actions} document={document} /> : null}
      {truncated ? <p className="workbench-value">Select at most {VIEWER_SELECTION_LIMIT} atoms to edit them.</p> : null}
      <SelectionEditor key={`${snapshotId(editor.current)}:${atoms.join(",")}`} structure={structure} annotations={annotations}
        atoms={atoms} disabled={busy} onApply={(edits) => void apply(edits)} onDelete={deleteSelected} onMove={move} onError={setInputError}
        onPositions={async (coordinates) => {
          // A rigid motion keeps every atom, so the panel selection survives the new snapshot.
          setInputError(null);
          const result = await draft.apply({ kind: "positions", coordinates, from: editor.current });
          if (result) { setSelection((current) => ({ atoms: selectedAtoms(current, structure), from: "panel", structure: result })); keepConstraints(result); }
        }} />
      <ConstraintEditor structure={structure} selected={atoms} constraints={constraints} disabled={busy} onError={setInputError}
        onChange={(next) => { setInputError(null); setHeld({ constraints: next, structure }); }} />
      {editor.current.metadata ? <GraphMetadataFields key={`metadata:${snapshotId(editor.current)}:${atoms.join(",")}`}
        snapshot={editor.current} atomIndex={atoms.length === 1 ? atoms[0] : null} disabled={busy}
        onApply={patch => { setInputError(null); void draft.apply({ kind: "metadata", from: editor.current, patch }); }} /> : null}
      <SegmentedControl aria-label="List" value={view} onValueChange={(value) => { if (value) setView(value as "atoms" | "bonds" | "cartesian"); }}>
        <SegmentedControlItem value="atoms">Atoms {structure.atoms.length}</SegmentedControlItem>
        <SegmentedControlItem value="bonds">Bonds {structure.bonds.length}</SegmentedControlItem>
        <SegmentedControlItem value="cartesian">Cartesian</SegmentedControlItem>
      </SegmentedControl>
      {view === "atoms"
        ? <AtomTable structure={structure} annotations={annotations} selected={atoms} disabled={busy} onPick={pick} onDelete={deleteSelected} onMove={move} onReorder={reorder} />
        : view === "bonds" ? <BondTable structure={structure} selected={atoms} onPick={(pair) => setSelection({ atoms: pair, from: "panel", structure })} />
        // Positions of the same atoms only: one Undo step that keeps bonds, stereo, metadata and atom IDs.
        : <CoordinateEditor atoms={structure.atoms} revision={snapshotId(editor.current)} disabled={busy}
          onApply={async (coordinates) => Boolean(await draft.apply({ kind: "positions", coordinates, from: editor.current }))} />}
    </div>
  );
}

function OptimizationOutcome({ outcome, structure, actions, document }: { outcome: GraphOutcome; structure: GraphEditResult; actions: ShellActions; document: ViewerDocument }) {
  const steps = outcome.iterations == null ? "" : `, ${outcome.iterations} step${outcome.iterations === 1 ? "" : "s"}`;
  return (
    <div className="geometry-panel-result" role="status">
      <p className="structure-edit-outcome">
        <span>{energyModelName(outcome.forceField ?? "MMFF94")}, {outcome.method} {outcome.initialEnergy.toFixed(2)} → {outcome.energy.toFixed(2)} kcal/mol{steps}</span>
        <span className="workbench-value" data-status={outcome.converged ? "success" : "failure"}>{outcome.converged ? "Converged" : "Not converged"}</span>
        {outcome.frameSampling === "steps" ? <OpenStepsButton actions={actions} document={document} frames={outcome.frames} /> : null}
      </p>
      <ConstraintResiduals residuals={outcome.residuals ?? []} atomLabel={(atom) => label(structure, atom)} />
    </div>
  );
}
