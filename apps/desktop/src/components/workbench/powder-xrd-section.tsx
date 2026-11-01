import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { MolecularAtom, UnitCell } from "../../lib/molecular-workbench/types";
import {
  broadenPattern, powderPatternCsv, powderPatternJson, powderSettingsProblem, profileProblem,
  XRD_DEFAULTS, XRD_LIMITS, XRD_RADIATION, type PowderPattern, type PowderPeak, type PowderProfile, type ProfileShape,
} from "../../lib/molecular-workbench/xrd/powder-xrd";
import { XRD_ENGINE } from "../../lib/molecular-workbench/xrd/xrd-engine";
import { fileStem } from "../../lib/workbench/formats";
import { runPowderXrdTask } from "../../lib/workbench/xrd-task";
import type { ShellActions } from "../types";
import { ChevronDown } from "../ui/app-icons";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { Spinner } from "../ui/spinner";
import { useCancellableJob } from "./use-workbench-source";
import "./vibrations.css";
import "./crystal.css";

type Radiation = (typeof XRD_RADIATION)[number]["id"] | "custom";
type Settings = { radiation: Radiation; customWavelength: number; twoThetaMin: number; twoThetaMax: number; shape: "sticks" | ProfileShape; fwhm: number };
const SHAPES = { sticks: "Sticks", gaussian: "Gaussian", lorentzian: "Lorentzian" } as const;
// Settings survive closing and reopening the dialog, like the spectrum line shape.
let remembered: Settings = { radiation: "cu-ka1", customWavelength: XRD_DEFAULTS.wavelength, twoThetaMin: XRD_DEFAULTS.twoThetaMin, twoThetaMax: XRD_DEFAULTS.twoThetaMax, shape: "sticks", fwhm: XRD_DEFAULTS.fwhm };
/** Settle time after the last edit before a new pattern starts; dragging a field does not queue workers. */
const RUN_DELAY_MS = 150;
/** Quick patterns finish before any progress chrome appears. */
const BUSY_DELAY_MS = 250;
const TABLE_ROWS = 300;
/** Sticks below a pixel are invisible; a large cell can have tens of thousands. */
const DRAWN_STICKS = 2_000;

const radiationOf = (settings: Settings) => XRD_RADIATION.find((item) => item.id === settings.radiation);
const wavelengthOf = (settings: Settings) => radiationOf(settings)?.wavelength ?? settings.customWavelength;
const radiationLabel = (settings: Settings) => radiationOf(settings)?.label ?? "Custom wavelength";
const formatHkl = (peak: PowderPeak) => peak.hkl.join(" ");

/** A profile the sampling budget cannot resolve is refused with its remedy; the sticks stay in view. */
function broaden(pattern: PowderPattern, shape: ProfileShape, fwhm: number): { profile: PowderProfile | null; error: string | null } {
  try {
    return { profile: broadenPattern(pattern, shape, fwhm), error: null };
  } catch (caught) {
    return { profile: null, error: caught instanceof Error ? caught.message : String(caught) };
  }
}

/**
 * Powder X-ray pattern of the structure's own unit cell. The pattern follows
 * the settings: each change starts a new worker after a short pause and
 * cancels the one before. A pattern is shown only for the source revision and
 * settings it was computed from.
 */
export function PowderXrdSection({ title, atoms, cell, revision, actions }: { title: string; atoms: MolecularAtom[]; cell: UnitCell; revision: string; actions: ShellActions }) {
  const [settings, setSettings] = useState(remembered);
  const update = (next: Partial<Settings>) => { remembered = { ...settings, ...next }; setSettings(remembered); };
  const wavelength = wavelengthOf(settings);
  const { twoThetaMin, twoThetaMax } = settings;
  const problem = powderSettingsProblem({ wavelength, twoThetaMin, twoThetaMax });
  const key = `${revision}|${wavelength}|${twoThetaMin}|${twoThetaMax}`;
  const job = useCancellableJob(revision);
  const [result, setResult] = useState<{ key: string; revision: string; label: string; pattern: PowderPattern } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (problem) { job.cancel(); return undefined; }
    const label = radiationLabel(settings);
    const timer = setTimeout(() => {
      void job.run("Simulating", (signal) => runPowderXrdTask({ atoms, cell, wavelength, twoThetaMin, twoThetaMax }, { signal }))
        .then((pattern) => { if (pattern) setResult({ key, revision, label, pattern }); });
    }, RUN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, problem, attempt]);

  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!job.running) { setBusy(false); return undefined; }
    const timer = setTimeout(() => setBusy(true), BUSY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [job.running]);

  // An older pattern of this source stays in view while its replacement runs.
  const current = result && result.revision === revision && (result.key === key || job.running) ? result : null;
  const pattern = current?.pattern ?? null;
  const fwhmProblem = settings.shape === "sticks" ? null : profileProblem(settings.fwhm);
  const broadened = useMemo(() => pattern && settings.shape !== "sticks" && !fwhmProblem ? broaden(pattern, settings.shape, settings.fwhm) : { profile: null, error: null },
    [pattern, settings.shape, settings.fwhm, fwhmProblem]);
  const profile = broadened.profile;
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = (kind: "csv" | "json") => {
    if (!pattern || !current) return;
    setSaveError(null);
    const context = { title, radiation: current.label, profile, engine: XRD_ENGINE };
    void Promise.resolve()
      .then(() => actions.saveKetcherExportFile({ title: `${fileStem(title)}-xrd.${kind}`, extension: kind, text: kind === "csv" ? powderPatternCsv(pattern, context) : powderPatternJson(pattern, context) }))
      .catch((caught) => setSaveError(caught instanceof Error ? caught.message : String(caught)));
  };

  const field = (label: string, value: number, onChange: (value: number) => void, options: { min: number; max: number; step: number; digits: number }) => (
    <label className="workbench-field">
      <span>{label}</span>
      <ScrubNumberField aria-label={label} value={value} min={options.min} max={options.max} step={options.step} largeStep={options.step * 10}
        formatValue={(next) => next.toFixed(options.digits)} onValueChange={onChange} onValueCommitted={onChange} />
    </label>
  );
  const error = problem ?? fwhmProblem ?? job.error ?? broadened.error ?? saveError;
  return (
    <section className="workbench-form powder-xrd" aria-label="Powder X-ray diffraction">
      <div className="powder-xrd-settings">
        <label className="workbench-field">
          <span>Radiation</span>
          <NativeSelect size="sm" aria-label="Radiation" value={settings.radiation} onChange={(event) => update({ radiation: event.currentTarget.value as Radiation })}>
            {XRD_RADIATION.map((item) => <NativeSelectOption key={item.id} value={item.id}>{`${item.label}, ${item.wavelength.toFixed(5)} Å`}</NativeSelectOption>)}
            <NativeSelectOption value="custom">Custom wavelength</NativeSelectOption>
          </NativeSelect>
        </label>
        {settings.radiation === "custom" ? field("λ, Å", settings.customWavelength, (value) => update({ customWavelength: value }), { ...XRD_LIMITS.wavelength, step: 0.01, digits: 5 }) : null}
        {field("2θ from, °", twoThetaMin, (value) => update({ twoThetaMin: value }), { ...XRD_LIMITS.twoTheta, step: 1, digits: 2 })}
        {field("2θ to, °", twoThetaMax, (value) => update({ twoThetaMax: value }), { ...XRD_LIMITS.twoTheta, step: 1, digits: 2 })}
      </div>
      <div className="workbench-row">
        <label className="workbench-field">
          <span>Profile</span>
          <NativeSelect size="sm" aria-label="Profile" value={settings.shape} onChange={(event) => update({ shape: event.currentTarget.value as Settings["shape"] })}>
            {(Object.keys(SHAPES) as Settings["shape"][]).map((shape) => <NativeSelectOption key={shape} value={shape}>{SHAPES[shape]}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        {settings.shape !== "sticks" ? field("FWHM, ° 2θ", settings.fwhm, (value) => update({ fwhm: value }), { ...XRD_LIMITS.fwhm, step: 0.01, digits: 3 }) : null}
        <div className="workbench-actions">
          {busy && job.running ? (
            <>
              <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />{job.running}</span>
              <Button type="button" size="xs" variant="secondary" onClick={job.cancel}>Cancel</Button>
            </>
          ) : null}
          {!job.running && !pattern && !problem ? <Button type="button" size="xs" onClick={() => setAttempt((value) => value + 1)}>Simulate</Button> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="xs" variant="ghost" disabled={!pattern || Boolean(job.running)}>Export<ChevronDown aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => save("csv")}>Peaks as CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => save("json")}>Pattern as JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error ? <p role="alert" className="workbench-error">{error}</p> : null}
      {pattern ? <PatternView key={current!.key} pattern={pattern} profile={profile} busy={Boolean(job.running)} /> : null}
    </section>
  );
}

const WIDTH = 320;
const HEIGHT = 120;
const PAD = { left: 6, right: 6, top: 6, bottom: 18 };

/** Indices of the `limit` most intense peaks, in 2θ order. */
function strongest(peaks: PowderPeak[], limit: number) {
  const indices = peaks.map((_, index) => index);
  if (indices.length <= limit) return indices;
  return indices.sort((a, b) => peaks[b].relativeIntensity - peaks[a].relativeIntensity).slice(0, limit).sort((a, b) => a - b);
}

/** Chart columns per viewBox unit; each keeps its first, lowest, highest and last sample. */
const CURVE_COLUMNS = 2;

/** The profile as an SVG path of at most four samples per column, so a narrow peak keeps its full height. */
function chartPath(profile: PowderProfile, x: (angle: number) => number, y: (value: number) => number) {
  const kept: number[] = [];
  for (let index = 0; index < profile.twoTheta.length;) {
    const column = Math.floor(x(profile.twoTheta[index]) * CURVE_COLUMNS);
    let low = index, high = index, last = index;
    while (last + 1 < profile.twoTheta.length && Math.floor(x(profile.twoTheta[last + 1]) * CURVE_COLUMNS) === column) {
      last++;
      if (profile.intensity[last] < profile.intensity[low]) low = last;
      if (profile.intensity[last] > profile.intensity[high]) high = last;
    }
    kept.push(...new Set([index, low, high, last].sort((a, b) => a - b)));
    index = last + 1;
  }
  return kept.map((index, order) => `${order ? "L" : "M"}${x(profile.twoTheta[index]).toFixed(2)} ${y(profile.intensity[index]).toFixed(2)}`).join("");
}

/** 2θ ticks every 1, 2, 5, 10, 20 or 30 degrees, at most ten. */
function angleTicks(start: number, end: number) {
  const step = [1, 2, 5, 10, 20, 30].find((candidate) => (end - start) / candidate <= 9) ?? 30;
  const ticks: number[] = [];
  for (let tick = Math.ceil(start / step) * step; tick <= end + 1e-9; tick += step) ticks.push(tick);
  return ticks;
}

/**
 * Sticks at each peak's 2θ, scaled to the strongest; the broadened curve is
 * scaled to its own maximum. Clicking a stick or a row selects that peak in
 * both; with focus on the chart, Left and Right move between peaks.
 */
function PatternView({ pattern, profile, busy }: { pattern: PowderPattern; profile: PowderProfile | null; busy: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const { peaks, twoThetaMin: start, twoThetaMax: end } = pattern;
  const x = (angle: number) => PAD.left + (angle - start) / (end - start) * (WIDTH - PAD.left - PAD.right);
  const y = (value: number) => HEIGHT - PAD.bottom - value / 100 * (HEIGHT - PAD.top - PAD.bottom);
  const curve = profile ? chartPath(profile, x, y) : null;
  // Every peak stays in the exports; the chart draws and the table lists the strongest, in 2θ order.
  const [sticks, rows] = useMemo(() => [DRAWN_STICKS, TABLE_ROWS].map((limit) => strongest(peaks, limit)), [peaks]);
  const current = selected === null ? null : peaks[selected];
  const describe = (peak: PowderPeak) => `2θ ${peak.twoTheta.toFixed(3)}°, d ${peak.d.toFixed(4)} Å, intensity ${peak.relativeIntensity.toFixed(1)}, (${formatHkl(peak)}), multiplicity ${peak.multiplicity}`;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const last = peaks.length - 1;
    const position = selected ?? -1;
    const next = { ArrowRight: position + 1, ArrowLeft: position < 0 ? last : position - 1, Home: 0, End: last }[event.key];
    if (next === undefined || last < 0) return;
    event.preventDefault();
    setSelected(Math.max(0, Math.min(last, next)));
  };
  if (!peaks.length) return <p className="workbench-status">No reflections in this 2θ range</p>;
  return (
    <div className="powder-xrd-result" aria-busy={busy || undefined}>
      <figure className="workbench-spectrum workbench-chart" role="slider" tabIndex={0} aria-label="Powder pattern"
        aria-valuemin={1} aria-valuemax={peaks.length} aria-valuenow={selected === null ? undefined : selected + 1}
        aria-valuetext={current ? describe(current) : "No peak selected"} onKeyDown={onKeyDown}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden>
          <line className="workbench-axis" x1={PAD.left} x2={WIDTH - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} />
          {angleTicks(start, end).map((tick) => <text key={tick} className="workbench-tick" x={x(tick)} y={HEIGHT - 4} textAnchor="middle">{tick}</text>)}
          {curve ? <path d={curve} fill="none" stroke="var(--color-text)" strokeWidth={1.25} /> : null}
          {sticks.map((index) => { const peak = peaks[index]; return (
            <g key={index} className="workbench-peak" data-selected={index === selected || undefined} onClick={() => setSelected(index)}>
              <line x1={x(peak.twoTheta)} x2={x(peak.twoTheta)} y1={HEIGHT - PAD.bottom} y2={y(peak.relativeIntensity)} />
              {peak.relativeIntensity >= 0.5 ? <rect x={x(peak.twoTheta) - 3} y={PAD.top} width={6} height={HEIGHT - PAD.top - PAD.bottom}><title>{describe(peak)}</title></rect> : null}
            </g>
          ); })}
        </svg>
        <figcaption className="workbench-axis-label" aria-hidden>{`2θ, °, λ = ${pattern.wavelength.toFixed(5)} Å`}</figcaption>
      </figure>
      <div className="powder-xrd-peaks">
        <table className="workbench-table" aria-label="Diffraction peaks">
          <thead>
            <tr>
              <th scope="col">hkl</th>
              <th scope="col">2θ, °</th>
              <th scope="col">d, Å</th>
              <th scope="col">Intensity</th>
              <th scope="col">Multiplicity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((index) => {
              const peak = peaks[index];
              return (
                <tr key={index} aria-selected={index === selected} data-selectable tabIndex={0} onClick={() => setSelected(index)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(index); } }}>
                  <th scope="row">{formatHkl(peak)}</th>
                  <td>{peak.twoTheta.toFixed(3)}</td>
                  <td>{peak.d.toFixed(4)}</td>
                  <td>{peak.relativeIntensity.toFixed(1)}</td>
                  <td>{peak.multiplicity}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length < peaks.length ? <span className="workbench-value">{`${rows.length} of ${peaks.length} peaks`}</span> : null}
    </div>
  );
}
