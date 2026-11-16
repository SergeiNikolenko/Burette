import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { GraphEditResult } from "../../../lib/molecular-workbench/graph-edit";
import type { AtomAnnotation } from "../../../lib/workbench/graph-draft";
import { signed } from "./values";

/**
 * Atoms in file order. One row is in the Tab order; arrows move between rows and
 * select, Shift extends, Space toggles, Delete removes and Option+arrows reorder.
 */
export function AtomTable({ structure, annotations, selected, disabled, onPick, onDelete, onMove, onReorder }: {
  structure: GraphEditResult; annotations: AtomAnnotation[]; selected: number[]; disabled: boolean;
  onPick: (atom: number, event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey">) => void; onDelete: () => void; onMove: (atom: number, offset: -1 | 1) => void;
  onReorder: (atom: number, insertion: number) => void;
}) {
  const body = useRef<HTMLTableSectionElement>(null);
  const drag = useRef<{ atom: number; structure: GraphEditResult; x: number; y: number; moved: boolean } | null>(null);
  const [drop, setDrop] = useState<{ row: number; side: "before" | "after" } | null>(null);
  const suppressClick = useRef(false);
  const endDrag = () => { drag.current = null; setDrop(null); };
  const dropTarget = (event: PointerEvent<HTMLTableCellElement>) => {
    const row = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLTableRowElement>("tr[data-atom]");
    if (!row || !body.current?.contains(row)) return null;
    const bounds = row.getBoundingClientRect();
    const side = event.clientY < bounds.top + bounds.height / 2 ? "before" as const : "after" as const;
    return { row: Number(row.dataset.atom), side };
  };
  const charged = annotations.some((item) => item.charge !== 0);
  const isotopes = annotations.some((item) => item.isotope !== 0);
  const focusRow = Math.min(selected.at(-1) ?? 0, structure.atoms.length - 1);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const focus = (atom: number) => body.current?.querySelector<HTMLElement>(`[data-atom="${atom}"]`)?.focus();
  useEffect(() => {
    // Keep keyboard focus on the moved or edited row after the table re-renders.
    if (body.current?.contains(globalThis.document?.activeElement ?? null)) focus(focusRow);
  }, [focusRow, structure]);
  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-atom]");
    if (!row) return;
    const atom = Number(row.dataset.atom);
    const last = structure.atoms.length - 1;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      if (!disabled) onMove(atom, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    const target = { ArrowUp: atom - 1, ArrowDown: atom + 1, Home: 0, End: last }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      const next = Math.max(0, Math.min(last, target));
      onPick(next, { metaKey: false, ctrlKey: false, shiftKey: event.shiftKey });
      focus(next);
    } else if (event.key === " ") {
      event.preventDefault();
      onPick(atom, { metaKey: true, ctrlKey: true, shiftKey: false });
    } else if ((event.key === "Delete" || event.key === "Backspace") && !disabled) {
      event.preventDefault();
      onDelete();
    }
  };
  return (
    <table className="workbench-table structure-edit-table" role="grid" aria-label="Atoms" aria-multiselectable>
      <thead>
        <tr>
          <th scope="col">Atom</th>
          {charged ? <th scope="col">Charge</th> : null}
          {isotopes ? <th scope="col">Mass</th> : null}
          <th scope="col">X, Å</th>
          <th scope="col">Y, Å</th>
          <th scope="col">Z, Å</th>
        </tr>
      </thead>
      <tbody ref={body} onKeyDown={onKeyDown}>
        {structure.atoms.map((atom, index) => (
          <tr key={index} data-atom={index} data-selectable aria-selected={selectedSet.has(index)} tabIndex={index === focusRow ? 0 : -1}
            data-drop={drop?.row === index ? drop.side : undefined}
            onPointerDownCapture={() => { suppressClick.current = false; }}
            onClick={(event) => {
              if (suppressClick.current && event.detail > 0) { suppressClick.current = false; return; }
              onPick(index, event);
            }}>
            <th scope="row" data-reorderable={!disabled && structure.atoms.length > 1 || undefined}
              onPointerDown={(event) => {
                if (disabled || structure.atoms.length < 2 || event.button !== 0 || !event.isPrimary || event.pointerType === "touch") return;
                drag.current = { atom: index, structure, x: event.clientX, y: event.clientY, moved: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const source = drag.current;
                if (disabled || source?.structure !== structure) return;
                if (!source.moved && Math.hypot(event.clientX - source.x, event.clientY - source.y) < 5) return;
                source.moved = true;
                const target = dropTarget(event);
                setDrop(current => current?.row === target?.row && current?.side === target?.side ? current : target);
              }}
              onPointerUp={(event) => {
                const source = drag.current;
                endDrag();
                if (!source?.moved) return;
                suppressClick.current = true;
                if (disabled || source.structure !== structure) return;
                const target = dropTarget(event);
                if (target) onReorder(source.atom, target.row + (target.side === "after" ? 1 : 0));
              }}
              onPointerCancel={endDrag} onLostPointerCapture={endDrag}>{atom.element}{index + 1}</th>
            {charged ? <td>{annotations[index]?.charge ? signed(annotations[index].charge) : ""}</td> : null}
            {isotopes ? <td>{annotations[index]?.isotope || ""}</td> : null}
            <td>{atom.x.toFixed(3)}</td>
            <td>{atom.y.toFixed(3)}</td>
            <td>{atom.z.toFixed(3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
