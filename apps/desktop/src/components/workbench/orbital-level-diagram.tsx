import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { MolecularOrbital } from "../../lib/molecular-workbench/scientific-types";
import { HARTREE_EV } from "../../lib/workbench/formats";

/** Occupied and virtual levels shown on each side of the gap; the table lists the rest. */
const WINDOW = 8;
/** Core levels hundreds of eV down would flatten the valence region, so they stay in the table only. */
const RANGE_EV = 20;
const HEIGHT = 260, TOP = 8, BOTTOM = HEIGHT - 22;
/** Strip width and the space between a strip and the shared axis. */
const STRIP = 48, AXIS_GAP = 16;
/** Leader length from a strip to its energy label, and the label line height. */
const LEADER = 20, LINE = 12;
/** Room for the longest label, "HOMO −10.48", past the end of its leader, until the drawn labels are measured. */
const LABEL = 76;
// Levels closer than this on screen share a row and sit side by side, as degenerate ones do.
const MIN_GAP = 2;
const GLIDE_MS = 240;
const MINUS = "−";

type Spin = MolecularOrbital["spin"];
/** `rank` is the orbital's place in its own spin channel; readers number orbitals across both channels or per channel. */
type Entry = { index: number; rank: number; orbital: MolecularOrbital };
type Scene = { low: number; high: number; energies: ReadonlyMap<number, number> };

function windowOf(orbitals: MolecularOrbital[], spin: Spin) {
  const channel: Entry[] = orbitals.map((orbital, index) => ({ orbital, index })).filter(({ orbital }) => orbital.spin === spin)
    .map((entry, rank) => ({ ...entry, rank })).sort((a, b) => a.orbital.energyHartree - b.orbital.energyHartree);
  const firstVirtual = channel.findIndex(({ orbital }) => orbital.occupancy <= 1e-6);
  const gap = firstVirtual < 0 ? channel.length : firstVirtual;
  return { levels: channel.slice(Math.max(0, gap - WINDOW), gap + WINDOW), homo: channel[gap - 1], lumo: channel[gap] };
}

function ticksFor(low: number, high: number) {
  const step = [0.5, 1, 2, 5, 10, 20].find((candidate) => (high - low) / candidate <= 5) ?? 50;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + 1e-9; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

/** Moves label positions apart by at least one line, inside [top, bottom], keeping their order. */
function spread(wanted: number[], top: number, bottom: number) {
  const order = wanted.map((value, i) => [value, i] as const).sort((a, b) => a[0] - b[0]);
  const at = order.map(([value]) => value);
  for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i], at[i - 1] + LINE);
  if (at.length && at[at.length - 1] > bottom) { at[at.length - 1] = bottom; for (let i = at.length - 2; i >= 0; i--) at[i] = Math.min(at[i], at[i + 1] - LINE); }
  if (at.length && at[0] < top) { at[0] = top; for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i], at[i - 1] + LINE); }
  const out: number[] = [];
  order.forEach(([, i], k) => { out[i] = at[k]; });
  return out;
}

const ev = (value: number) => `${value < 0 ? MINUS : ""}${Math.abs(value).toFixed(2)}`;
const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Glides the energy range and every level's energy to a new scene (another frame), starting from where they are. */
function useGlide(target: Scene | null) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const start = current.current;
    if (!target || !start || start === target || reducedMotion()) { current.current = target; setShown(target); return; }
    const begin = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - begin) / GLIDE_MS), k = 1 - (1 - t) ** 3;
      const mix = (from: number, to: number) => from + (to - from) * k;
      const energies = new Map([...target.energies].map(([index, value]) => [index, mix(start.energies.get(index) ?? value, value)]));
      const next = t < 1 ? { low: mix(start.low, target.low), high: mix(start.high, target.high), energies } : target;
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown ?? target;
}

/**
 * Energy levels around the frontier orbitals on one to-scale axis, α left and β right of it.
 * Every level carries its energy on a leader; the HOMO–LUMO gap is shaded and the same orbital
 * of both spins is joined. A level is chosen with a click or the arrow keys (Left and Right
 * change spin); levels glide to their new energies when the frame changes.
 */
export function OrbitalLevelDiagram({ orbitals, frontier, selected, selectable, onSelect }: {
  orbitals: MolecularOrbital[];
  frontier: Map<number, "HOMO" | "LUMO">;
  selected: number | null;
  selectable: boolean;
  onSelect: (index: number) => void;
}) {
  const id = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  // Label room on the left and right, from the widest label drawn on that side.
  const [room, setRoom] = useState<readonly [number, number]>([LABEL, LABEL]);
  const svg = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const need = [0, 0];
    svg.current?.querySelectorAll<SVGTextElement>(".orbital-level-label").forEach((text) => {
      const side = text.getAttribute("text-anchor") === "end" ? 0 : 1;
      if (typeof text.getBBox === "function") need[side] = Math.max(need[side], text.getBBox().width);
    });
    const next = [0, 1].map((side) => need[side] ? Math.ceil(need[side]) + 2 : room[side]) as [number, number];
    if (next[0] !== room[0] || next[1] !== room[1]) setRoom(next);
  });
  const spins = (["alpha", "beta"] as const).filter((spin) => orbitals.some((orbital) => orbital.spin === spin));
  const unrestricted = spins.length > 1;
  const model = useMemo(() => {
    // Both spins share one energy range: from the lowest HOMO down to the highest LUMO up.
    const windows = spins.map((spin) => windowOf(orbitals, spin));
    const frontierEv = windows.flatMap((window) => [window.homo, window.lumo].flatMap((entry) => entry ? [entry.orbital.energyHartree * HARTREE_EV] : []));
    const floor = Math.min(...frontierEv) - RANGE_EV, ceiling = Math.max(...frontierEv) + RANGE_EV;
    const columns = windows.map((window) => window.levels.filter(({ orbital }) => orbital.energyHartree * HARTREE_EV >= floor && orbital.energyHartree * HARTREE_EV <= ceiling));
    const energies = new Map(columns.flat().map(({ index, orbital }) => [index, orbital.energyHartree * HARTREE_EV]));
    if (!energies.size) return null;
    const values = [...energies.values()];
    const pad = Math.max(0.5, (Math.max(...values) - Math.min(...values)) * 0.04);
    const scene: Scene = { low: Math.min(...values) - pad, high: Math.max(...values) + pad, energies };
    return { columns, gaps: windows.map((window) => [window.homo?.index, window.lumo?.index] as const), scene };
  }, [orbitals, spins.join()]);
  const scene = useGlide(model?.scene ?? null);
  if (!model || !scene) return null;

  const axis = unrestricted ? LEADER + 4 + room[0] + STRIP + AXIS_GAP : 34;
  const width = axis + AXIS_GAP + STRIP + LEADER + 4 + room[1];
  const y = (value: number) => BOTTOM - (value - scene.low) / (scene.high - scene.low) * (BOTTOM - TOP);
  const energyOf = (index: number) => scene.energies.get(index) ?? model.scene.energies.get(index)!;
  // α strip left of the axis, β right of it; a restricted strip sits right of its axis.
  const sides = spins.map((_, c) => unrestricted && c === 0 ? { x: axis - AXIS_GAP - STRIP, dir: -1 } : { x: axis + AXIS_GAP, dir: 1 });
  const columns = model.columns.map((column, c) => {
    const { x, dir } = sides[c];
    const rows: { y: number; members: Entry[] }[] = [];
    for (const entry of column) {
      const top = y(energyOf(entry.index));
      const row = rows.at(-1);
      if (row && Math.abs(row.y - top) < MIN_GAP) row.members.push(entry); else rows.push({ y: top, members: [entry] });
    }
    const bars = rows.flatMap((row) => {
      const w = (STRIP + 4) / row.members.length - 4;
      return row.members.map((entry, k) => ({ ...entry, x: x + k * (w + 4), y: y(energyOf(entry.index)), width: w }));
    });
    const labels = spread(bars.map((bar) => bar.y), TOP + 2, BOTTOM);
    const edge = dir > 0 ? x + STRIP : x;
    return { dir, x, edge, levels: bars.map((bar, k) => ({ ...bar, labelY: labels[k], labelX: edge + dir * (LEADER + 4) })) };
  });
  const all = columns.flatMap((column) => column.levels);
  const active = all.find((level) => level.index === selected);

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!selectable) return;
    const column = columns.findIndex((item) => item.levels.some((level) => level.index === selected));
    const byEnergy = [...columns[Math.max(0, column)].levels].sort((a, b) => a.orbital.energyHartree - b.orbital.energyHartree);
    const at = byEnergy.findIndex((level) => level.index === selected);
    let next: (typeof all)[number] | undefined;
    if (event.key === "ArrowUp") next = byEnergy[Math.min(byEnergy.length - 1, at + 1)];
    else if (event.key === "ArrowDown") next = byEnergy[Math.max(0, at - 1)];
    else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && unrestricted) {
      const other = columns[event.key === "ArrowLeft" ? 0 : columns.length - 1].levels;
      const current = active?.orbital.energyHartree ?? 0;
      next = other.reduce<(typeof all)[number] | undefined>((best, level) => !best || Math.abs(level.orbital.energyHartree - current) < Math.abs(best.orbital.energyHartree - current) ? level : best, undefined);
    } else if (event.key === "Home") next = byEnergy[0];
    else if (event.key === "End") next = byEnergy.at(-1);
    if (!next) return;
    event.preventDefault();
    onSelect(next.index);
  };

  // The same orbital in both spin channels, joined across the axis.
  const partners = unrestricted ? columns[0].levels.flatMap((alpha) => {
    const beta = columns[1].levels.find((level) => level.rank === alpha.rank);
    return beta ? [{ alpha, beta }] : [];
  }) : [];
  const label = (level: (typeof all)[number], dir: number) => {
    const tag = frontier.get(level.index);
    return { tag, text: ev(energyOf(level.index)), chars: ev(energyOf(level.index)).length + (tag ? 5 : 0), dir };
  };
  const pill = active ? (() => {
    const column = columns.find((item) => item.levels.includes(active))!, { chars, dir } = label(active, column.dir);
    const w = chars * 6.3 + 10;
    return { x: dir > 0 ? active.labelX - 5 : active.labelX - w + 5, y: active.labelY - 7, w };
  })() : null;

  return (
    <svg ref={svg} className="orbital-diagram" role="listbox" aria-label="Orbital energy levels" tabIndex={selectable ? 0 : -1}
      aria-activedescendant={active ? `${id}-${active.index}` : undefined} width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} onKeyDown={onKeyDown}>
      {columns.map((column, c) => {
        const [homo, lumo] = model.gaps[c];
        if (homo === undefined || lumo === undefined || !scene.energies.has(homo) || !scene.energies.has(lumo)) return null;
        const top = y(energyOf(lumo)), bottom = y(energyOf(homo));
        return <rect key={c} className="orbital-diagram-gap" x={column.x - 4} y={top} width={STRIP + 8} height={Math.max(0, bottom - top)} rx={3} />;
      })}
      {partners.map(({ alpha, beta }) => (
        <line key={alpha.index} className="orbital-diagram-partner" data-active={hovered === alpha.index || hovered === beta.index || selected === alpha.index || selected === beta.index || undefined}
          x1={alpha.x + alpha.width + 3} y1={alpha.y} x2={beta.x - 3} y2={beta.y} />
      ))}
      <line className="orbital-diagram-axis" x1={axis} x2={axis} y1={TOP} y2={BOTTOM} />
      {ticksFor(scene.low, scene.high).map((tick) => (
        <text key={tick} className="orbital-diagram-tick" x={unrestricted ? axis : axis - 6} y={y(tick)} textAnchor={unrestricted ? "middle" : "end"} dominantBaseline="middle">{tick < 0 ? `${MINUS}${-tick}` : tick}</text>
      ))}
      <text className="orbital-diagram-unit" x={axis} y={HEIGHT - 4} textAnchor="middle">eV</text>
      {unrestricted ? columns.map((column, c) => (
        <text key={c} className="orbital-diagram-unit" x={column.x + STRIP / 2} y={HEIGHT - 4} textAnchor="middle">{spins[c] === "alpha" ? "α" : "β"}</text>
      )) : null}
      {pill ? <rect className="orbital-diagram-pill" width={pill.w} height={14} rx={4} style={{ transform: `translate(${pill.x}px, ${pill.y}px)` } as CSSProperties} /> : null}
      {columns.map((column) => column.levels.map((level, k) => {
        const { orbital, index } = level;
        const { tag, text, dir } = label(level, column.dir);
        const name = `Orbital ${orbital.index + 1}${unrestricted ? ` ${orbital.spin === "alpha" ? "α" : "β"}` : ""}${tag ? `, ${tag}` : ""}, ${(orbital.energyHartree * HARTREE_EV).toFixed(3)} eV, occupancy ${orbital.occupancy.toFixed(orbital.occupancy % 1 ? 3 : 0)}`;
        const leader = `M${column.edge + dir * 3} ${level.y}C${column.edge + dir * 12} ${level.y} ${column.edge + dir * 10} ${level.labelY} ${column.edge + dir * LEADER} ${level.labelY}`;
        // Bars grow out of the axis, nearest the gap first.
        const order = Math.abs(k - column.levels.findIndex((item) => frontier.get(item.index) === "LUMO"));
        return (
          <g key={index} id={`${id}-${index}`} role="option" aria-selected={index === selected} aria-label={name}
            className="orbital-level" data-selected={index === selected || undefined} data-occupied={orbital.occupancy > 1e-6 || undefined}
            data-tag={tag} style={{ "--orbital-delay": `${Math.min(order, 10) * 14}ms` } as CSSProperties}
            onClick={selectable ? () => onSelect(index) : undefined} onPointerEnter={() => setHovered(index)} onPointerLeave={() => setHovered((value) => value === index ? null : value)}>
            <title>{name}</title>
            <rect className="orbital-level-hit" x={column.x - 4} y={level.y - 5} width={STRIP + 8} height={10} rx={4} />
            <rect className="orbital-level-hit" x={dir > 0 ? column.edge : level.labelX - 72} y={level.labelY - 6} width={LEADER + 76} height={12} rx={4} />
            <line className="orbital-level-bar" data-side={dir > 0 ? "right" : "left"} x1={level.x} x2={level.x + level.width} y1={level.y} y2={level.y} />
            <path className="orbital-level-leader" d={leader} />
            <text className="orbital-level-label" x={level.labelX} y={level.labelY} textAnchor={dir > 0 ? "start" : "end"} dominantBaseline="middle">
              {dir > 0 ? <>{text}{tag ? <tspan className="orbital-level-tag" dx={4}>{tag}</tspan> : null}</>
                : <>{tag ? <tspan className="orbital-level-tag" dx={0}>{tag}</tspan> : null}<tspan dx={tag ? 4 : 0}>{text}</tspan></>}
            </text>
          </g>
        );
      }))}
    </svg>
  );
}
