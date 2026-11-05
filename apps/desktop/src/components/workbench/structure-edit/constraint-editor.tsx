import { measureGeometry } from "../../../../../../scripts/molecular-geometry.js";
import type { GraphEditResult } from "../../../lib/molecular-workbench/graph-edit";
import type { GeometryConstraint } from "../../../lib/molecular-workbench/optimization";
import { ShortcutTooltip } from "../../shortcut-tooltip";
import { Pin, X } from "../../ui/app-icons";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { label } from "./values";

const KINDS = { 2: "distance", 3: "angle", 4: "dihedral" } as const;
const UNITS = { distance: "Å", angle: "°", dihedral: "°" } as const;
const key = (constraint: GeometryConstraint) => `${constraint.kind}:${constraint.atoms.join(",")}`;
// The same measurement in either atom order is the same constraint.
const sameAtoms = (a: number[], b: number[]) => a.join(",") === b.join(",") || a.join(",") === [...b].reverse().join(",");

function measured(structure: GraphEditResult, kind: (typeof KINDS)[keyof typeof KINDS], atoms: number[]) {
  return measureGeometry(kind, atoms.map((atom) => ({ id: String(atom), position: [structure.atoms[atom].x, structure.atoms[atom].y, structure.atoms[atom].z] }))).value as number;
}

/**
 * What the next Optimize holds: frozen atoms keep their coordinates, and each held distance,
 * angle or dihedral is restrained to its target. A new hold starts at the current value.
 */
export function ConstraintEditor({ structure, selected, constraints, disabled, onChange, onError }: {
  structure: GraphEditResult; selected: number[]; constraints: GeometryConstraint[]; disabled: boolean;
  onChange: (constraints: GeometryConstraint[]) => void; onError: (message: string) => void;
}) {
  const frozen = new Set(constraints.flatMap((item) => item.kind === "freeze" ? item.atoms : []));
  const allFrozen = selected.length > 0 && selected.every((atom) => frozen.has(atom));
  const kind = KINDS[selected.length as keyof typeof KINDS];
  const held = kind && constraints.some((item) => item.kind === kind && sameAtoms(item.atoms, selected));
  if (!selected.length && !constraints.length) return null;

  const toggleFreeze = () => onChange(allFrozen
    ? constraints.filter((item) => item.kind !== "freeze" || !selected.includes(item.atoms[0]))
    : [...constraints, ...selected.filter((atom) => !frozen.has(atom)).map((atom) => ({ kind: "freeze" as const, atoms: [atom] }))]);
  const hold = () => {
    if (!kind) return;
    try { onChange([...constraints, { kind, atoms: [...selected], target: measured(structure, kind, selected) }]); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  // The field shows a rounded target; leaving it unchanged keeps the exact value.
  const shown = (constraint: GeometryConstraint) => constraint.target?.toFixed(constraint.kind === "distance" ? 3 : 1);
  const setTarget = (constraint: GeometryConstraint, text: string) => {
    if (text.trim() === shown(constraint)) return;
    const target = Number(text.trim().replace(",", "."));
    if (!text.trim() || !Number.isFinite(target)) { onError("Enter a number for the target."); return; }
    if (target !== constraint.target) onChange(constraints.map((item) => item === constraint ? { ...item, target } : item));
  };

  return (
    <section className="structure-edit-constraints" aria-label="Optimization constraints">
      {selected.length ? (
        <div className="workbench-toolbar">
          <ShortcutTooltip label={allFrozen ? "Let the selected atoms move in Optimize" : "Keep the selected atoms in place in Optimize"}>
            <Button type="button" variant="ghost" size="xs" disabled={disabled} aria-pressed={allFrozen} onClick={toggleFreeze}><Pin aria-hidden />{allFrozen ? "Unfreeze" : "Freeze"}</Button>
          </ShortcutTooltip>
          {kind && !held ? (
            <ShortcutTooltip label={`Hold this ${kind} at a target value in Optimize`}>
              <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={hold}>Hold {kind}</Button>
            </ShortcutTooltip>
          ) : null}
        </div>
      ) : null}
      {constraints.length ? (
        <ul className="structure-edit-constraint-list">
          {constraints.map((item) => {
            const name = item.atoms.map((atom) => label(structure, atom)).join("–");
            return (
              <li key={key(item)}>
                <span>{name}</span>
                {item.kind === "freeze" ? <span className="workbench-value">Frozen</span> : (
                  <span className="structure-edit-constraint-target">
                    <Input variant="compact" inputMode="decimal" spellCheck={false} autoComplete="off" disabled={disabled}
                      key={item.target} defaultValue={shown(item)} aria-label={`Target ${item.kind} of ${name}, ${UNITS[item.kind]}`}
                      onBlur={(event) => setTarget(item, event.currentTarget.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") setTarget(item, event.currentTarget.value); }} />
                    {UNITS[item.kind]}
                  </span>
                )}
                <Button type="button" variant="ghost" size="icon-2xs" aria-label={`Remove the ${item.kind === "freeze" ? "freeze" : item.kind} of ${name}`} disabled={disabled}
                  onClick={() => onChange(constraints.filter((other) => other !== item))}><X aria-hidden /></Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
