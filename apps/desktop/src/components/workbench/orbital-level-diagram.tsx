import { useId, useMemo, type KeyboardEvent } from "react";
import type { MolecularOrbital } from "../../lib/molecular-workbench/scientific-types";
import { HARTREE_EV } from "../../lib/workbench/formats";

/** Occupied and virtual levels shown on each side of the gap; the table lists the rest. */
const WINDOW = 8;
/** Core levels hundreds of eV down would flatten the valence region, so they stay in the table only. */
const RANGE_EV = 20;
const HEIGHT = 240;
const AXIS = 40;
const COLUMN = 92;
const LEVEL = 26;
const PAD = 10;
// Levels closer than this on screen share a row and sit side by side, as degenerate ones do.
const MIN_GAP = 2;
// HOMO and LUMO labels of one column keep at least one text line apart.
const TAG_GAP = 11;

type Spin = MolecularOrbital["spin"];
type Level = { index: number; orbital: MolecularOrbital; x: number; y: number; width: number };

function windowOf(orbitals: MolecularOrbital[], spin: Spin) {
  const channel = orbitals.map((orbital, index) => ({ orbital, index })).filter(({ orbital }) => orbital.spin === spin)
    .sort((a, b) => a.orbital.energyHartree - b.orbital.energyHartree);
  const firstVirtual = channel.findIndex(({ orbital }) => orbital.occupancy <= 1e-6);
  const gap = firstVirtual < 0 ? channel.length : firstVirtual;
  return { levels: channel.slice(Math.max(0, gap - WINDOW), gap + WINDOW), homo: channel[gap - 1]?.orbital, lumo: channel[gap]?.orbital };
}

function ticksFor(low: number, high: number) {
  const step = [0.5, 1, 2, 5, 10, 20].find((candidate) => (high - low) / candidate <= 6) ?? 50;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + 1e-9; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

/**
 * Energy levels around the frontier orbitals, one column per spin. Occupancy is drawn as
 * arrows; a level is chosen with a click or the arrow keys (Left and Right change spin).
 */
export function OrbitalLevelDiagram({ orbitals, frontier, selected, selectable, onSelect }: {
  orbitals: MolecularOrbital[];
  frontier: Map<number, "HOMO" | "LUMO">;
  selected: number | null;
  selectable: boolean;
  onSelect: (index: number) => void;
}) {
  const id = useId();
  const spins = (["alpha", "beta"] as const).filter((spin) => orbitals.some((orbital) => orbital.spin === spin));
  const unrestricted = spins.length > 1;
  const layout = useMemo(() => {
    // Both spins share one energy range: from the lowest HOMO down to the highest LUMO up.
    const windows = spins.map((spin) => windowOf(orbitals, spin));
    const frontierEv = (key: "homo" | "lumo") => windows.flatMap((window) => window[key] ? [window[key]!.energyHartree * HARTREE_EV] : []);
    const floor = Math.min(...frontierEv("homo"), ...frontierEv("lumo")) - RANGE_EV;
    const ceiling = Math.max(...frontierEv("lumo"), ...frontierEv("homo")) + RANGE_EV;
    const columns = windows.map((window) => window.levels.filter(({ orbital }) => orbital.energyHartree * HARTREE_EV >= floor && orbital.energyHartree * HARTREE_EV <= ceiling));
    const energies = columns.flat().map(({ orbital }) => orbital.energyHartree * HARTREE_EV);
    if (!energies.length) return null;
    const pad = Math.max(0.5, (Math.max(...energies) - Math.min(...energies)) * 0.05);
    const low = Math.min(...energies) - pad, high = Math.max(...energies) + pad;
    const y = (ev: number) => PAD + (high - ev) / (high - low) * (HEIGHT - 2 * PAD);
    const levels = columns.map((column, c) => {
      const rows: { y: number; members: typeof column }[] = [];
      for (const entry of column) {
        const top = y(entry.orbital.energyHartree * HARTREE_EV);
        const row = rows.at(-1);
        if (row && Math.abs(row.y - top) < MIN_GAP) row.members.push(entry); else rows.push({ y: top, members: [entry] });
      }
      const centre = AXIS + COLUMN * c + COLUMN / 2;
      return rows.flatMap((row) => {
        const width = Math.min(LEVEL, (COLUMN - 24) / row.members.length - 4);
        const span = row.members.length * (width + 4) - 4;
        return row.members.map(({ orbital, index }, k): Level => ({ index, orbital, x: centre - span / 2 + k * (width + 4), y: row.y, width }));
      });
    });
    // A narrow gap would stack LUMO over HOMO, so the two labels move apart around their middle.
    const tagY = new Map<number, number>();
    for (const column of levels) {
      const tagged = column.filter((level) => frontier.has(level.index));
      const homo = tagged.find((level) => frontier.get(level.index) === "HOMO"), lumo = tagged.find((level) => frontier.get(level.index) === "LUMO");
      for (const level of tagged) tagY.set(level.index, level.y);
      if (homo && lumo && homo.y - lumo.y < TAG_GAP) {
        const middle = (homo.y + lumo.y) / 2;
        tagY.set(homo.index, middle + TAG_GAP / 2);
        tagY.set(lumo.index, middle - TAG_GAP / 2);
      }
    }
    return { levels, ticks: ticksFor(low, high), y, tagY };
  }, [orbitals, frontier, spins.join()]);
  if (!layout) return null;
  const all = layout.levels.flat();
  const width = AXIS + COLUMN * spins.length + 8;
  const active = all.find((level) => level.index === selected);

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!selectable) return;
    const column = layout.levels.findIndex((levels) => levels.some((level) => level.index === selected));
    const levels = layout.levels[Math.max(0, column)];
    const byEnergy = [...levels].sort((a, b) => a.orbital.energyHartree - b.orbital.energyHartree);
    const at = byEnergy.findIndex((level) => level.index === selected);
    let next: Level | undefined;
    if (event.key === "ArrowUp") next = byEnergy[Math.min(byEnergy.length - 1, at + 1)];
    else if (event.key === "ArrowDown") next = byEnergy[Math.max(0, at - 1)];
    else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && unrestricted) {
      const other = layout.levels[event.key === "ArrowLeft" ? 0 : layout.levels.length - 1];
      const current = active?.orbital.energyHartree ?? 0;
      next = other.reduce<Level | undefined>((best, level) => !best || Math.abs(level.orbital.energyHartree - current) < Math.abs(best.orbital.energyHartree - current) ? level : best, undefined);
    } else if (event.key === "Home") next = byEnergy[0];
    else if (event.key === "End") next = byEnergy.at(-1);
    if (!next) return;
    event.preventDefault();
    onSelect(next.index);
  };

  return (
    <svg className="orbital-diagram" role="listbox" aria-label="Orbital energy levels" tabIndex={selectable ? 0 : -1}
      aria-activedescendant={active ? `${id}-${active.index}` : undefined} width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} onKeyDown={onKeyDown}>
      {layout.ticks.map((tick) => (
        <g key={tick} className="orbital-diagram-tick">
          <line x1={AXIS - 4} x2={AXIS} y1={layout.y(tick)} y2={layout.y(tick)} />
          <text x={AXIS - 6} y={layout.y(tick)} textAnchor="end" dominantBaseline="middle">{tick}</text>
        </g>
      ))}
      <line className="orbital-diagram-axis" x1={AXIS} x2={AXIS} y1={PAD} y2={HEIGHT - PAD} />
      <text className="orbital-diagram-unit" x={4} y={PAD} dominantBaseline="middle">eV</text>
      {unrestricted ? spins.map((spin, c) => (
        <text key={spin} className="orbital-diagram-unit" x={AXIS + COLUMN * c + COLUMN / 2} y={HEIGHT - 2} textAnchor="middle">{spin === "alpha" ? "α" : "β"}</text>
      )) : null}
      {all.map((level) => {
        const { orbital, index } = level;
        const tag = frontier.get(index);
        const arrows = orbital.occupancy > 1.5 ? 2 : orbital.occupancy > 0.5 ? 1 : 0;
        const down = orbital.spin === "beta" && unrestricted;
        const name = `Orbital ${orbital.index + 1}${unrestricted ? ` ${orbital.spin === "alpha" ? "α" : "β"}` : ""}${tag ? `, ${tag}` : ""}, ${(orbital.energyHartree * HARTREE_EV).toFixed(3)} eV, occupancy ${orbital.occupancy.toFixed(orbital.occupancy % 1 ? 3 : 0)}`;
        return (
          <g key={index} id={`${id}-${index}`} role="option" aria-selected={index === selected} aria-label={name}
            className="orbital-level" data-selected={index === selected || undefined} data-occupied={orbital.occupancy > 1e-6 || undefined}
            onClick={selectable ? () => onSelect(index) : undefined}>
            <title>{name}</title>
            <rect x={level.x - 2} y={level.y - 6} width={level.width + 4} height={12} className="orbital-level-hit" />
            <line x1={level.x} x2={level.x + level.width} y1={level.y} y2={level.y} />
            {Array.from({ length: arrows }, (_, k) => {
              const x = arrows === 2 ? level.x + level.width / 2 + (k ? 3 : -3) : level.x + level.width / 2;
              const up = arrows === 2 ? k === 0 : !down;
              return <path key={k} className="orbital-level-arrow" d={up ? `M${x} ${level.y + 5}V${level.y - 5}M${x - 2} ${level.y - 3}L${x} ${level.y - 5}L${x + 2} ${level.y - 3}`
                : `M${x} ${level.y - 5}V${level.y + 5}M${x - 2} ${level.y + 3}L${x} ${level.y + 5}L${x + 2} ${level.y + 3}`} />;
            })}
            {tag ? <text className="orbital-level-tag" x={level.x + level.width + 4} y={layout.tagY.get(index) ?? level.y} dominantBaseline="middle">{tag}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}
