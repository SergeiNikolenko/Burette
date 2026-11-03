import type { GraphEdit, GraphEditResult } from "../../../lib/molecular-workbench/graph-edit";
import { alignCoordinates, type CoordinateAxis } from "../../../lib/molecular-workbench/coordinate-align";
import type { Vec3 } from "../../../lib/molecular-workbench/types";
import type { AtomAnnotation } from "../../../lib/workbench/graph-draft";
import { ShortcutTooltip } from "../../shortcut-tooltip";
import { ChevronDown, ChevronUp, Delete } from "../../ui/app-icons";
import { Button } from "../../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/dropdown-menu";
import { SegmentedControl, SegmentedControlItem } from "../../ui/segmented-control";
import { AtomFields } from "./atom-fields";
import { BOND_ORDERS, label } from "./values";

/**
 * Avogadro's Align tool on the selection, in pick order: the first atom moves to the origin and
 * the second onto the chosen positive axis. Every atom moves rigidly as one Undo step.
 */
function AlignAction({ structure, atoms, disabled, onPositions, onError }: {
  structure: GraphEditResult; atoms: number[]; disabled: boolean; onPositions: (coordinates: Vec3[]) => void; onError: (error: string) => void;
}) {
  const [origin, target] = atoms.map(atom => label(structure, atom));
  const align = (axis: CoordinateAxis) => {
    try { onPositions(alignCoordinates(structure.atoms.map(atom => [atom.x, atom.y, atom.z]), { origin: atoms[0], target: atoms[1], axis }).coordinates); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  if (atoms.length === 1) {
    return <ShortcutTooltip label={`Move ${origin} to the origin`}>
      <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={() => align("x")}>Align</Button>
    </ShortcutTooltip>;
  }
  return <DropdownMenu>
    <ShortcutTooltip label={`Move ${origin} to the origin and ${target} onto an axis`}>
      <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="xs" disabled={disabled}>Align<ChevronDown aria-hidden /></Button></DropdownMenuTrigger>
    </ShortcutTooltip>
    <DropdownMenuContent align="end">
      {(["x", "y", "z"] as const).map(axis => <DropdownMenuItem key={axis} onSelect={() => align(axis)}>{target} on {axis} axis</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function SelectionEditor({ structure, annotations, atoms, disabled, onApply, onPositions, onDelete, onMove, onError }: {
  structure: GraphEditResult; annotations: AtomAnnotation[]; atoms: number[]; disabled: boolean;
  onApply: (edits: GraphEdit[]) => void; onPositions: (coordinates: Vec3[]) => void; onDelete: () => void; onMove: (atom: number, offset: -1 | 1) => void; onError: (error: string) => void;
}) {
  if (!atoms.length) return null;
  const title = atoms.length <= 4 ? atoms.map((atom) => label(structure, atom)).join(", ") : `${atoms.length} atoms`;
  const deleteButton = (
    <ShortcutTooltip label={atoms.length === 1 ? "Delete atom" : "Delete atoms"} shortcut="⌫">
      <Button type="button" variant="ghost" size="icon-xs" aria-label={atoms.length === 1 ? "Delete atom" : "Delete atoms"} disabled={disabled} onClick={onDelete}><Delete aria-hidden /></Button>
    </ShortcutTooltip>
  );
  if (atoms.length === 1) {
    const atom = atoms[0];
    return (
      <section className="structure-edit-selection" aria-label={`Atom ${title}`}>
        <div className="workbench-toolbar">
          <h3 className="structure-edit-title">{title}</h3>
          <ShortcutTooltip label="Move up" shortcut="⌥↑">
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" disabled={disabled || atom === 0} onClick={() => onMove(atom, -1)}><ChevronUp aria-hidden /></Button>
          </ShortcutTooltip>
          <ShortcutTooltip label="Move down" shortcut="⌥↓">
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Move down" disabled={disabled || atom === structure.atoms.length - 1} onClick={() => onMove(atom, 1)}><ChevronDown aria-hidden /></Button>
          </ShortcutTooltip>
          <AlignAction structure={structure} atoms={atoms} disabled={disabled} onPositions={onPositions} onError={onError} />
          {deleteButton}
        </div>
        <AtomFields structure={structure} annotation={annotations[atom]} atom={atom} disabled={disabled} onApply={onApply} onError={onError} />
      </section>
    );
  }
  const bond = atoms.length === 2 ? structure.bonds.find((item) => (item.a === atoms[0] && item.b === atoms[1]) || (item.a === atoms[1] && item.b === atoms[0])) : null;
  return (
    <section className="structure-edit-selection" aria-label={title}>
      <div className="workbench-toolbar">
        <h3 className="structure-edit-title">{atoms.length === 2 ? `${label(structure, atoms[0])}–${label(structure, atoms[1])}` : title}</h3>
        {bond?.order === 1.5 ? <span className="workbench-value">Aromatic</span> : null}
        {atoms.length === 2 ? <AlignAction structure={structure} atoms={atoms} disabled={disabled} onPositions={onPositions} onError={onError} /> : null}
        {deleteButton}
      </div>
      {atoms.length === 2 ? (
        <SegmentedControl aria-label="Bond order" value={bond && bond.order !== 1.5 ? String(bond.order) : bond ? "" : "0"}
          onValueChange={(value) => { if (value) onApply([{ kind: "set-bond", a: atoms[0], b: atoms[1], order: Number(value) as 0 | 1 | 2 | 3 }]); }}>
          {BOND_ORDERS.map(([value, name]) => <SegmentedControlItem key={value} value={value} disabled={disabled}>{name}</SegmentedControlItem>)}
        </SegmentedControl>
      ) : null}
    </section>
  );
}
