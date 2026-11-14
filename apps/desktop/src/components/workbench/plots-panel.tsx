import { useMemo, useState, useId, type KeyboardEvent, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, XAxis, YAxis, usePlotArea, useXAxisInverseScale } from "recharts";
import { measureGeometry } from "../../../../../scripts/molecular-geometry.js";
import type { ScientificDocument } from "../../lib/molecular-workbench/quantum";
import type { ReactionPath } from "../../lib/molecular-workbench/scientific-types";
import { ENERGY_UNITS, type EnergyUnit } from "../../lib/workbench/formats";
import { useRetainedTrajectorySource } from "../../lib/workbench/retained-trajectory-source";
import type { ShellActions } from "../types";
import type { ViewerDocument } from "../../types";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart";
import { Input } from "../ui/input";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import "./workbench-layout.css";
import "./plots.css";

const KINDS = { 2: ["distance", "Distance", "Å"], 3: ["angle", "Angle", "°"], 4: ["dihedral", "Dihedral", "°"] } as const;
const CONVERGENCE = [["maxForce", "Max force", "Eh/bohr"], ["rmsForce", "RMS force", "Eh/bohr"], ["gradientNorm", "Gradient norm", "Eh/bohr"],
  ["maxStep", "Max step", "a.u."], ["rmsStep", "RMS step", "a.u."], ["energyChange", "Energy change", "Eh"]] as const;
type ConvergenceItem = typeof CONVERGENCE[number][0];
const exponent = (value: number) => value.toExponential(2);
const UNIT_STORAGE_KEY = "burette.workbench.energy-unit";

function parseAtoms(text: string, atomCount: number) {
  const tokens = text.trim().split(/[\s,]+/u).filter(Boolean);
  if (!tokens.length) return { atoms: null, error: null };
  const atoms = tokens.map(Number);
  if (!(atoms.length in KINDS) || atoms.some((atom) => !Number.isInteger(atom) || atom < 1 || atom > atomCount) || new Set(atoms).size !== atoms.length) {
    return { atoms: null, error: `Enter 2, 3 or 4 distinct atom numbers from 1 to ${atomCount}.` };
  }
  return { atoms: atoms.map((atom) => atom - 1), error: null };
}

function storedUnit(): EnergyUnit {
  try {
    const value = localStorage.getItem(UNIT_STORAGE_KEY);
    return value && value in ENERGY_UNITS ? value as EnergyUnit : "kcal/mol";
  } catch { return "kcal/mol"; }
}

/** `path` plots a scan or reaction path: one point per path point, `frames` -1 where the file has no geometry. */
export type PlotAxis = { kind: "frame" | "time" | "path"; values: number[]; frames?: number[]; frameCount?: number; label?: string };
type Axis = PlotAxis;

/**
 * About four evenly spaced ticks on a 1, 2, 2.5 or 5 step, labelled with just
 * enough precision that neighbouring ticks never read the same.
 */
function niceTicks(values: (number | null)[]) {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!finite.length) return null;
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const multiple = [1, 2, 2.5, 5, 10].find((candidate) => rough / magnitude <= candidate * (1 + 1e-9)) ?? 10;
  const step = multiple * magnitude;
  const first = Math.floor(min / step + 1e-9);
  const ticks = Array.from({ length: Math.ceil(max / step - 1e-9) - first + 1 }, (_, index) => (first + index) * step);
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (multiple === 2.5 ? 1 : 0));
  const largest = Math.max(...ticks.map(Math.abs));
  let format = (value: number) => value.toFixed(decimals);
  // Very large or very fine scales stay narrow in exponent form.
  if (largest >= 1e6 || decimals > 5) {
    const precision = [1, 2, 3, 4, 5, 6, 7, 8].find((digits) => new Set(ticks.map((value) => value.toExponential(digits))).size === ticks.length) ?? 8;
    format = (value: number) => (value === 0 ? "0" : value.toExponential(precision));
  }
  return { ticks, domain: [ticks[0], ticks.at(-1)!] as [number, number], format: (value: number) => format(Math.abs(value) < step * 1e-9 ? 0 : value) };
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/** Whole decades around the positive values and the reference, labelled 10⁻⁴ and so on. */
function logTicks(values: (number | null)[], reference?: number) {
  const positive = [...values, reference ?? null].filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  if (!positive.length) return null;
  const low = Math.floor(Math.log10(Math.min(...positive)) + 1e-9);
  const high = Math.max(low + 1, Math.ceil(Math.log10(Math.max(...positive)) - 1e-9));
  const every = Math.ceil((high - low + 1) / 7);
  const ticks = Array.from({ length: high - low + 1 }, (_, index) => low + index).filter((power) => (power - low) % every === 0).map((power) => 10 ** power);
  const format = (value: number) => {
    const power = Math.round(Math.log10(value));
    return `10${power < 0 ? "⁻" : ""}${[...String(Math.abs(power))].map((digit) => SUPERSCRIPT[Number(digit)]).join("")}`;
  };
  return { ticks, domain: [10 ** low, 10 ** high] as [number, number], format };
}

const AXIS_UNITS = { bond: "Å", angle: "°", dihedral: "°" } as const;
/** The path's horizontal axis in the user's terms: the scanned atoms (1-based, as the input lists them) or the coordinate's name. */
function pathAxisLabel(path: ReactionPath, atoms: ScientificDocument["atoms"]) {
  const axis = path.axis;
  if ("atoms" in axis) return `${axis.atoms.map((atom) => `${atoms[atom]?.element ?? ""}${atom + 1}`).join("–")}, ${AXIS_UNITS[axis.kind]}`;
  if (axis.kind === "reaction-coordinate") return "Reaction coordinate, amu½·bohr";
  if (axis.kind === "parameter") return "Scan parameter";
  return path.kind === "irc" ? "Step from the TS" : "Scan point";
}

export function PlotsPanel({ document, science, sourceText }: { document: ViewerDocument; actions: ShellActions; science: ScientificDocument; sourceText: string }) {
  const { cursor, seek, error } = useRetainedTrajectorySource(document, science, sourceText);
  const errorId = useId();
  const [atomText, setAtomText] = useState("");
  const [unit, setUnit] = useState<EnergyUnit>(storedUnit);
  // Simulation time is offered only when every frame states it.
  const hasTime = science.frames.every((item) => item.timePs !== undefined && Number.isFinite(item.timePs));
  const [axisKind, setAxisKind] = useState<Axis["kind"]>(hasTime ? "time" : "frame");
  const axis: Axis = useMemo(() => ({
    kind: hasTime ? axisKind : "frame",
    values: science.frames.map((item, index) => (hasTime && axisKind === "time" ? item.timePs! : index + 1)),
  }), [science, hasTime, axisKind]);

  const measurement = parseAtoms(atomText, science.atoms.length);
  const kind = measurement.atoms ? KINDS[measurement.atoms.length as 2 | 3 | 4] : null;
  const { factor, digits } = ENERGY_UNITS[unit];
  const energies = useMemo(() => {
    const values = science.frames.map((item) => item.energyHartree);
    if (!values.some((value) => value !== undefined)) return null;
    const reference = Math.min(...values.filter((value): value is number => value !== undefined));
    return values.map((value) => (value === undefined ? null : (value - reference) * factor));
  }, [science, factor]);
  const geometry = useMemo(() => {
    if (!measurement.atoms || !kind) return null;
    return science.frames.map((item) => {
      try {
        return measureGeometry(kind[0], measurement.atoms!.map((atom) => ({ id: String(atom), position: [item.atoms[atom].x, item.atoms[atom].y, item.atoms[atom].z] }))).value;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "INVALID_GEOMETRY") return null;
        throw error;
      }
    });
  }, [science, atomText]);
  const temperatures = useMemo(() => (science.frames.some((item) => item.temperatureKelvin !== undefined)
    ? science.frames.map((item) => item.temperatureKelvin ?? null) : null), [science]);
  const maxForces = useMemo(() => (science.frames.some((item) => item.forcesKcalMolAngstrom?.length)
    ? science.frames.map((item) => (item.forcesKcalMolAngstrom?.length ? Math.max(...item.forcesKcalMolAngstrom.map((force) => Math.hypot(...force))) : null))
    : null), [science]);
  const convergenceItems = useMemo(() => CONVERGENCE.filter(([key]) => science.frames.some((item) => item.convergence?.[key])), [science]);
  const [convergenceKey, setConvergenceKey] = useState<ConvergenceItem>("maxForce");
  const convergenceItem = convergenceItems.find(([key]) => key === convergenceKey) ?? convergenceItems[0];
  const convergence = useMemo(() => (convergenceItem ? science.frames.map((item) => item.convergence?.[convergenceItem[0]]?.value ?? null) : null), [science, convergenceItem]);
  const threshold = convergenceItem ? science.frames.find((item) => item.convergence?.[convergenceItem[0]]?.threshold)?.convergence?.[convergenceItem[0]]?.threshold : undefined;

  const chooseUnit = (value: EnergyUnit) => {
    setUnit(value);
    try { localStorage.setItem(UNIT_STORAGE_KEY, value); } catch { /* storage unavailable: keep the choice for this panel */ }
  };
  const path = science.path;
  const pathAxis = useMemo<Axis | null>(() => (path ? { kind: "path", values: path.points.map((point) => point.x), frames: path.points.map((point) => point.frame ?? -1), label: pathAxisLabel(path, science.atoms) } : null), [path, science]);
  const pathEnergies = useMemo(() => {
    if (!path) return null;
    const reference = Math.min(...path.points.map((point) => point.energyHartree));
    return path.points.map((point) => (point.energyHartree - reference) * factor);
  }, [path, factor]);
  const pathCursor = cursor !== null && path ? path.points.findIndex((point) => point.frame === cursor) : -1;
  // An IRC opens as its points, so the per-frame energy chart would repeat the path chart.
  const pathIsFrames = Boolean(path && path.points.length === science.frames.length && path.points.every((point, index) => point.frame === index));
  const current = cursor !== null ? science.frames[cursor] : null;
  const series = { axis, cursor, onSeek: seek };

  return (
    <div className="dock-content workbench-plots">
      <div className="workbench-row">
        {/* The dock keeps plotting the file it was opened for when another tab becomes active; name it. */}
        <span className="workbench-value workbench-source" title={document.path}>{document.title}</span>
        <span className="workbench-value">{cursor !== null ? `Frame ${cursor + 1} of ${science.frames.length}` : `${science.frames.length} frames`}</span>
        {cursor !== null && hasTime ? <span className="workbench-value">{science.frames[cursor].timePs!.toFixed(3)} ps</span> : null}
        {current?.energyHartree !== undefined ? <span className="workbench-value">E {current.energyHartree.toFixed(6)} Eh</span> : null}
        {science.converged !== undefined ? <span className="workbench-value" data-status={science.converged ? "success" : "failure"}>{science.converged ? "Converged" : "Not converged"}</span> : null}
        <span className="workbench-actions">
          {hasTime ? (
            <SegmentedControl aria-label="Horizontal axis" value={axisKind} onValueChange={(value) => { if (value) setAxisKind(value as Axis["kind"]); }}>
              <SegmentedControlItem value="frame">Frame</SegmentedControlItem>
              <SegmentedControlItem value="time">Time</SegmentedControlItem>
            </SegmentedControl>
          ) : null}
        </span>
      </div>
      {error ? <p role="alert" className="workbench-error">{error}</p> : null}
      <div className="workbench-charts">
        {path && pathAxis ? (
          <SeriesChart axis={pathAxis} cursor={pathCursor >= 0 ? pathCursor : null} onSeek={seek} name="ΔE" unit={unit} values={pathEnergies} digits={digits}
            hollow={path.points.map((point) => point.converged === false)}
            header={(value) => <h3 className="workbench-chart-title">{path.kind === "scan" ? "Scan" : "Reaction path"}, ΔE{value}</h3>} />
        ) : null}
        {energies && science.frames.length > 1 && !pathIsFrames ? (
          <SeriesChart {...series} name="ΔE" unit={unit} values={energies} digits={digits}
            header={(value) => (
              <>
                <h3 className="workbench-chart-title">ΔE{value}</h3>
                <NativeSelect size="sm" aria-label="Energy unit" name="plotEnergyUnit" value={unit} onChange={(event) => chooseUnit(event.currentTarget.value as EnergyUnit)}>
                  {(Object.keys(ENERGY_UNITS) as EnergyUnit[]).map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}
                </NativeSelect>
              </>
            )} />
        ) : null}
        {convergenceItem ? (
          <SeriesChart {...series} name={convergenceItem[1]} unit={convergenceItem[2]} values={convergence} digits={2} format={exponent} scale="log" reference={threshold}
            header={(value) => (
              <>
                <h3 className="workbench-chart-title">Convergence, {convergenceItem[2]}{value}</h3>
                <NativeSelect size="sm" aria-label="Convergence value" name="plotConvergence" value={convergenceItem[0]} onChange={(event) => setConvergenceKey(event.currentTarget.value as ConvergenceItem)}>
                  {convergenceItems.map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}
                </NativeSelect>
              </>
            )} />
        ) : null}
        <SeriesChart {...series} name={kind ? kind[1] : "Geometry"} unit={kind?.[2] ?? ""} values={geometry} digits={kind?.[0] === "distance" ? 3 : 1}
          header={(value) => (
            <label className="workbench-field workbench-field-inline">
              <span>{kind ? `${kind[1]}, ${kind[2]}` : "Atoms"}{value}</span>
              <Input variant="compact" value={atomText} placeholder="1 2" spellCheck={false} autoComplete="off" inputMode="numeric"
                name="plotAtoms" aria-describedby={measurement.error ? errorId : undefined} aria-label="Atom numbers to measure" aria-invalid={Boolean(measurement.error)} onChange={(event) => setAtomText(event.target.value)} />
            </label>
          )}
          footer={measurement.error ? <p id={errorId} role="alert" className="workbench-error">{measurement.error}</p> : null} />
        {temperatures ? (
          <SeriesChart {...series} name="Temperature" unit="K" values={temperatures} digits={1}
            header={(value) => <h3 className="workbench-chart-title">Temperature, K{value}</h3>} />
        ) : null}
        {maxForces ? (
          <SeriesChart {...series} name="Max force" unit="kcal/(mol·Å)" values={maxForces} digits={2}
            header={(value) => <h3 className="workbench-chart-title">Max force, kcal/(mol·Å){value}</h3>} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Seeks to the point nearest the click along x. The chart's own click state reports the first point
 * on a numeric axis, so the pointer position is mapped through the axis scale instead.
 */
function SeekLayer({ points, onSeek }: { points: { x: number; frame: number }[]; onSeek: (frame: number) => void }) {
  const area = usePlotArea();
  const invert = useXAxisInverseScale();
  if (!area || !invert) return null;
  return (
    <rect x={area.x} y={area.y} width={area.width} height={area.height} fill="transparent"
      onClick={(event) => {
        const svg = event.currentTarget.ownerSVGElement;
        if (!svg) return;
        const box = svg.getBoundingClientRect();
        // The svg can be scaled by window zoom, so convert client pixels into its own units.
        const x = Number(invert(((event.clientX - box.left) * svg.width.baseVal.value) / box.width));
        let best: { x: number; frame: number } | null = null;
        for (const point of points) if (point.frame > 0 && (!best || Math.abs(point.x - x) < Math.abs(best.x - x))) best = point;
        if (best) onSeek(best.frame - 1);
      }} />
  );
}

/**
 * One per-frame series with its own header. The current scene frame is marked;
 * while the scene plays these frames the chart is a keyboard slider (arrows step
 * one frame, Page Up and Page Down ten, Home and End jump to the ends) and a click
 * on the chart seeks the scene.
 */
export function SeriesChart({ name, unit, values, digits, format = (value) => value.toFixed(digits), scale, reference, axis, cursor, onSeek, header, footer, hollow }: {
  name: string; unit: string; values: (number | null)[] | null; digits: number;
  format?: (value: number) => string;
  /** A log axis drops values that are not positive. */
  scale?: "log";
  /** A dashed level such as a convergence threshold. */
  reference?: number;
  axis: Axis; cursor: number | null; onSeek?: (index: number) => void;
  header: (current: ReactNode) => ReactNode; footer?: ReactNode;
  /** Points drawn as open circles, such as scan points whose optimization stopped short. */
  hollow?: boolean[];
}) {
  const path = axis.kind === "path";
  const data = useMemo(() => values?.flatMap((raw, index) => {
    const value = scale === "log" && raw !== null && !(raw > 0) ? null : raw;
    const point = { x: axis.values[index], frame: (axis.frames?.[index] ?? index) + 1, value, index };
    // Sparse observed frames must not draw a line through unread frames; a path joins its points.
    return !path && axis.frames && index > 0 && axis.frames[index] > axis.frames[index - 1] + 1
      ? [{ x: (axis.values[index - 1] + point.x) / 2, frame: 0, value: null, index: -1 }, point] : [point];
  }) ?? null, [values, axis, scale]);
  const yTicks = useMemo(() => (values ? scale === "log" ? logTicks(values, reference) : niceTicks(values) : null), [values, scale, reference]);
  const timeTicks = useMemo(() => (axis.kind !== "frame" ? niceTicks(axis.values) : null), [axis]);
  const cursorValue = cursor !== null ? values?.[cursor] ?? null : null;
  const currentValue = scale === "log" && cursorValue !== null && !(cursorValue > 0) ? null : cursorValue;
  const label = unit ? `${name}, ${unit}` : name;
  // A path slider moves between its points; a frame slider between frames.
  const currentFrame = cursor !== null ? (path ? cursor : axis.frames?.[cursor] ?? cursor) : null;
  const frameCount = path ? axis.values.length : axis.frameCount ?? axis.values.length;
  const xLabel = (index: number) => (axis.kind === "time" ? `${axis.values[index].toFixed(3)} ps`
    : path ? `${axis.label ?? ""} ${Number(axis.values[index].toPrecision(6))}`.trim() : `Frame ${(axis.frames?.[index] ?? index) + 1}`);
  const valueText = (index: number) => {
    const value = values?.[index];
    const place = path ? xLabel(index) : `Frame ${(axis.frames?.[index] ?? index) + 1}`;
    return value === null || value === undefined ? place : `${place}, ${name} ${format(value)} ${unit}`.trim();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (currentFrame === null || !onSeek) return;
    if (path) {
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10, Home: -frameCount, End: frameCount }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      const target = Math.min(frameCount - 1, Math.max(0, currentFrame + step));
      const frame = axis.frames?.[target] ?? -1;
      if (frame >= 0) onSeek(frame);
      return;
    }
    const next = { ArrowLeft: currentFrame - 1, ArrowDown: currentFrame - 1, ArrowRight: currentFrame + 1, ArrowUp: currentFrame + 1,
      PageDown: currentFrame - 10, PageUp: currentFrame + 10, Home: 0, End: frameCount - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onSeek(next);
  };
  const chart = data ? (
    // The line, its current-frame dot and the tooltip all read the series colour from this one config key.
    <ChartContainer config={{ value: { label, color: "var(--color-text)" } }} className="aspect-auto h-36 w-full">
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
>
        <CartesianGrid vertical={false} />
        {timeTicks ? (
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} ticks={timeTicks.ticks.filter((tick) => tick >= axis.values[0] && tick <= axis.values.at(-1)!)} tickLine={false} axisLine={false} minTickGap={24} tickFormatter={timeTicks.format} />
        ) : (
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} tickLine={false} axisLine={false} minTickGap={24} />
        )}
        <YAxis width={52} tickLine={false} axisLine={false} interval={0} scale={scale ?? "auto"} allowDataOverflow={scale === "log"} domain={yTicks?.domain ?? ["auto", "auto"]} ticks={yTicks?.ticks} tickFormatter={yTicks?.format} />
        {reference !== undefined ? <ReferenceLine y={reference} stroke="var(--color-text-secondary)" strokeDasharray="4 3" /> : null}
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => {
          const index = Number(payload?.[0]?.payload?.index);
          return index >= 0 ? xLabel(index) : "";
        }} />} />
        {cursor !== null ? <ReferenceLine x={axis.values[cursor]} stroke="var(--color-text-secondary)" /> : null}
        <Line type="linear" dataKey="value" name={label} stroke="var(--color-value)" strokeWidth={1.5} connectNulls={false} isAnimationActive={false}
          dot={path ? (props: { cx?: number; cy?: number; index?: number }) => <circle key={props.index} cx={props.cx} cy={props.cy} r={2.5} stroke="var(--color-value)" strokeWidth={1.5} fill={hollow?.[props.index ?? -1] ? "var(--bg-base)" : "var(--color-value)"} />
            : axis.frames ? { r: 2 } : false} />
        {onSeek ? <SeekLayer points={data} onSeek={onSeek} /> : null}
        {cursor !== null && currentValue !== null ? <ReferenceDot x={axis.values[cursor]} y={currentValue} r={3} fill="var(--color-value)" stroke="none" /> : null}
      </LineChart>
    </ChartContainer>
  ) : null;
  return (
    <section aria-label={path ? `${name} along the path` : `${name} per frame`}>
      <div className="workbench-chart-header">{header(currentValue !== null ? <span className="workbench-chart-current">{format(currentValue)}</span> : null)}</div>
      {footer}
      {chart && cursor !== null && onSeek ? (
        <div className="workbench-chart" role="slider" tabIndex={0} aria-label={`${label} frame`} aria-valuemin={1} aria-valuemax={frameCount}
          aria-valuenow={currentFrame! + 1} aria-valuetext={valueText(cursor)} onKeyDown={onKeyDown}>
          {chart}
        </div>
      ) : chart ? <div className="workbench-chart">{chart}</div> : null}
    </section>
  );
}
