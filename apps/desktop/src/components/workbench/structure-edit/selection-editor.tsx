import type { GraphEdit, GraphEditResult } from "../../../lib/molecular-workbench/graph-edit";
import type { AtomAnnotation } from "../../../lib/workbench/graph-draft";
import { ShortcutTooltip } from "../../shortcut-tooltip";
import { ChevronDown, ChevronUp, Delete } from "../../ui/app-icons";
import { Button } from "../../ui/button";
import { SegmentedControl, SegmentedControlItem } from "../../ui/segmented-control";
import { AtomFields } from "./atom-fields";
import { BOND_ORDERS, label } from "./values";

export function SelectionEditor({ structure, annotations, atoms, disabled, onApply, onDelete, onMove, onError }: {
  structure: GraphEditResult; annotations: AtomAnnotation[]; atoms: number[]; disabled: boolean;
  onApply: (edits: GraphEdit[]) => void; onDelete: () => void; onMove: (atom: number, offset: -1 | 1) => void; onError: (error: string) => void;
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
