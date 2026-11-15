import { useRef, type KeyboardEvent } from "react";
import type { GraphEditResult } from "../../../lib/molecular-workbench/graph-edit";
import { bondName, label } from "./values";

export function BondTable({ structure, selected, onPick }: { structure: GraphEditResult; selected: number[]; onPick: (pair: number[]) => void }) {
  const body = useRef<HTMLTableSectionElement>(null);
  const isSelected = (a: number, b: number) => selected.length === 2 && selected.includes(a) && selected.includes(b);
  const focusRow = Math.max(0, structure.bonds.findIndex((bond) => isSelected(bond.a, bond.b)));
  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-bond]");
    if (!row) return;
    const index = Number(row.dataset.bond);
    const target = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: structure.bonds.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(structure.bonds.length - 1, target));
    onPick([structure.bonds[next].a, structure.bonds[next].b]);
    body.current?.querySelector<HTMLElement>(`[data-bond="${next}"]`)?.focus();
  };
  if (!structure.bonds.length) return null;
  return (
    <table className="workbench-table structure-edit-table" role="grid" aria-label="Bonds">
      <thead>
        <tr>
          <th scope="col">Bond</th>
          <th scope="col">Order</th>
        </tr>
      </thead>
      <tbody ref={body} onKeyDown={onKeyDown}>
        {structure.bonds.map((bond, index) => (
          <tr key={`${bond.a}-${bond.b}`} data-bond={index} data-selectable aria-selected={isSelected(bond.a, bond.b)} tabIndex={index === focusRow ? 0 : -1}
            onClick={() => onPick([bond.a, bond.b])}>
            <th scope="row">{label(structure, bond.a)}–{label(structure, bond.b)}</th>
            <td>{bondName(bond.order)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
