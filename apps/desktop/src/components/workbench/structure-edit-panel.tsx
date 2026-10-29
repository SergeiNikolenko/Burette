import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { GraphEdit, GraphEditResult } from "../../lib/molecular-workbench/graph-edit";
import type { Vec3 } from "../../lib/molecular-workbench/types";
import { HARTREE_KCAL_MOL, fileStem } from "../../lib/workbench/formats";
import { openScientificDocument } from "../../lib/workbench/generated-document-open";
import { useViewerAtomSelection } from "../../lib/workbench/selection";
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
import { GraphMetadataFields } from "./graph-metadata-fields";
import { OptimizeButton } from "./optimize-button";
import { useGraphDraft, type GraphOutcome, type GraphSnapshot } from "./use-graph-draft";
import { SelectionEditor } from "./structure-edit/selection-editor";
import { AtomTable } from "./structure-edit/atom-table";
import { BondTable } from "./structure-edit/bond-table";
import { label, normalizeElement } from "./structure-edit/values";
import "./workbench-layout.css";
import "./structure-edit/structure-edit.css";

// Atom indices mean something only in the structure they were picked in. Every
// snapshot transition (an edit, Undo, Redo, a reload) replaces the structure
// object, so a selection of another structure reads as empty in the same render.
type Selection = { atoms: number[]; from: "panel" | "viewer"; structure: GraphEditResult | null };
const NO_SELECTION: Selection = { atoms: [], from: "panel", structure: null };

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

export function StructureEditPanel({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  const sourceEditing = useSourceEditing();
  const draft = useGraphDraft(document);
  const session = draft.session;
  const editor = draft.history;
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [view, setView] = useState<"atoms" | "bonds">("atoms");
  const [addElement, setAddElement] = useState("C");
  const [inputError, setInputError] = useState<string | null>(null);
  const viewerSelection = useViewerAtomSelection(document.id);
  const send = useRef(actions.runStructureViewerAction);
  send.current = actions.runStructureViewerAction;
  const currentStructure = editor?.current.structure;
  const atoms = selectedAtoms(selection, currentStructure);

  // A selection made in the 3D view replaces the panel's selection; clearing it in
  // the view clears it here too. Atoms picked in the panel stay picked.
  const loaded = Boolean(editor);
  useEffect(() => {
    if (!editor) return;
    const structure = editor.current.structure;
    if (!viewerSelection) { setSelection((current) => (current.from === "viewer" && current.atoms.length ? { atoms: [], from: "viewer", structure } : current)); return; }
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
    if (result) setSelection({ atoms: select ? select(result) : mapSelection(atoms, result), from: "panel", structure: result });
  };
  // Adding or removing hydrogens renumbers atoms, so the selection does not carry over.
  const hydrogens = async (kind: "add-hydrogens" | "remove-hydrogens") => {
    setInputError(null);
    if (await draft.apply({ kind })) setSelection(NO_SELECTION);
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
  const move = (atom: number, offset: -1 | 1) => {
    const target = atom + offset;
    if (target < 0 || target >= structure.atoms.length) return;
    const order = structure.atoms.map((_, index) => index);
    order[atom] = target;
    order[target] = atom;
    void apply([{ kind: "reorder-atoms", order }], () => [target]);
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
  const error = inputError ?? draft.error ?? session?.diagnostic ?? null;
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
        <OptimizeButton atomCount={structure.atoms.length} size="xs" variant="secondary" disabled={busy} onOptimize={(method, forceField) => void draft.apply({ kind: "optimize", method, forceField })} />
        <DropdownMenu>
          <ShortcutTooltip label="More actions">
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="More actions" disabled={busy}><DotsHorizontal aria-hidden /></Button>
            </DropdownMenuTrigger>
          </ShortcutTooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void hydrogens("add-hydrogens")}>Add hydrogens</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void hydrogens("remove-hydrogens")}>Remove hydrogens</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {busy ? (
          <span className="workbench-status" role="status"><Spinner aria-hidden className="size-3" /><span className="sr-only">Applying…</span>
            <Button type="button" variant="ghost" size="xs" onClick={draft.cancel}>Cancel</Button>
          </span>
        ) : null}
        {session?.dirty ? (
          <ShortcutTooltip label={session.saveDisabledReason ?? session.saveLabel ?? "Save"}>
            <span className="ml-auto">
              <Button type="button" variant="secondary" size="xs" disabled={busy || Boolean(session.saveDisabledReason) || session.saving}
                onClick={() => void sourceEditing?.save(document)}>{session.saveLabel ?? "Save"}</Button>
            </span>
          </ShortcutTooltip>
        ) : null}
      </div>
      {error ? <p role="alert" className="workbench-error">{error}</p> : null}
      {outcome ? <OptimizationOutcome outcome={outcome} onOpenSteps={() => openSteps(actions, document, outcome)} /> : null}
      {truncated ? <p className="workbench-value">Select at most {VIEWER_SELECTION_LIMIT} atoms to edit them.</p> : null}
      <SelectionEditor key={`${snapshotId(editor.current)}:${atoms.join(",")}`} structure={structure} annotations={annotations}
        atoms={atoms} disabled={busy} onApply={(edits) => void apply(edits)} onDelete={deleteSelected} onMove={move} onError={setInputError} />
      {editor.current.metadata ? <GraphMetadataFields key={`metadata:${snapshotId(editor.current)}:${atoms.join(",")}`}
        snapshot={editor.current} atomIndex={atoms.length === 1 ? atoms[0] : null} disabled={busy}
        onApply={patch => { setInputError(null); void draft.apply({ kind: "metadata", from: editor.current, patch }); }} /> : null}
      <SegmentedControl aria-label="List" value={view} onValueChange={(value) => { if (value) setView(value as "atoms" | "bonds"); }}>
        <SegmentedControlItem value="atoms">Atoms {structure.atoms.length}</SegmentedControlItem>
        <SegmentedControlItem value="bonds">Bonds {structure.bonds.length}</SegmentedControlItem>
      </SegmentedControl>
      {view === "atoms"
        ? <AtomTable structure={structure} annotations={annotations} selected={atoms} disabled={busy} onPick={pick} onDelete={deleteSelected} onMove={move} />
        : <BondTable structure={structure} selected={atoms} onPick={(pair) => setSelection({ atoms: pair, from: "panel", structure })} />}
    </div>
  );
}

/** The minimizer steps as a trajectory; MMFF94 kcal/mol become hartree so Plots can chart them in any unit. */
function openSteps(actions: ShellActions, document: ViewerDocument, outcome: GraphOutcome) {
  const frames = outcome.frames;
  if (!frames || frames.length < 2) return;
  void openScientificDocument(actions, `${fileStem(document.title)}-optimization`, {
    format: "xyz", atoms: frames[0].atoms, modes: [], orbitals: [],
    frames: frames.map((frame) => ({ atoms: frame.atoms, energyHartree: frame.energy / HARTREE_KCAL_MOL })),
  }, "steps");
}

function OptimizationOutcome({ outcome, onOpenSteps }: { outcome: GraphOutcome; onOpenSteps: () => void }) {
  const steps = outcome.iterations === undefined ? "" : `, ${outcome.iterations} step${outcome.iterations === 1 ? "" : "s"}`;
  return (
    <p className="geometry-panel-result structure-edit-outcome" role="status">
      <span>{outcome.forceField ?? "MMFF94"}, {outcome.method} {outcome.initialEnergy.toFixed(2)} → {outcome.energy.toFixed(2)} kcal/mol{steps}</span>
      <span className="workbench-value" data-status={outcome.converged ? "success" : "failure"}>{outcome.converged ? "Converged" : "Not converged"}</span>
      {outcome.frames && outcome.frames.length > 1 ? <Button type="button" variant="ghost" size="xs" onClick={onOpenSteps}>Open steps</Button> : null}
    </p>
  );
}
