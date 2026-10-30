import { useState, type KeyboardEvent } from "react";
import type { VibrationalMode } from "../../lib/molecular-workbench/scientific-types";
import { plotVibrationalSpectrum, VIBRATIONAL_PLOT_DEFAULTS, type VibrationalPlotKind, type VibrationalPlotOptions } from "../../lib/molecular-workbench/vibrational-spectrum-plot";
import { formatFrequency } from "../../lib/workbench/vibrational-modes";
import { Checkbox } from "../ui/checkbox";
import { ScrubNumberField } from "../ui/scrub-number-input";

const remembered: Partial<Record<VibrationalPlotKind, VibrationalPlotOptions>> = {};
const WIDTH = 320, HEIGHT = 120, LEFT = 38, RIGHT = 8, TOP = 8, BOTTOM = 22;

/** Peak-height curves and their raw sticks share one physical x axis and one display y scale. */
export function VibrationalPlot({ modes, sourceModes = modes, kind, selected, onSelect }: { modes: VibrationalMode[]; sourceModes?: VibrationalMode[]; kind: VibrationalPlotKind; selected: number | null; onSelect: (index: number) => void }) {
  const [options, setOptions] = useState(() => remembered[kind] ?? { ...VIBRATIONAL_PLOT_DEFAULTS[kind] });
  const [showRaw, setShowRaw] = useState(true);
  const update = (key: keyof VibrationalPlotOptions, value: number) => {
    const next = { ...options, [key]: value };
    remembered[kind] = next;
    setOptions(next);
  };
  const quantity = (mode: VibrationalMode) => kind === "ir" ? mode.intensityKmMol : mode.ramanActivityAngstrom4Amu;
  const center = (mode: VibrationalMode) => (mode.frequencyCm1 - options.offsetCm1) / options.scale;
  const low = Math.min(options.axisStartCm1, options.axisEndCm1), high = Math.max(options.axisStartCm1, options.axisEndCm1);
  const peaks = modes.filter(mode => mode.frequencyCm1 > 0 && (quantity(mode) ?? 0) > 0 && center(mode) >= low && center(mode) <= high)
    .sort((a, b) => (options.axisStartCm1 > options.axisEndCm1 ? -1 : 1) * (center(a) - center(b)));
  const position = peaks.findIndex(mode => mode.index === selected), current = peaks[position];
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!peaks.length) return;
    const last = peaks.length - 1;
    const next = { ArrowRight: position + 1, ArrowDown: position + 1, ArrowLeft: position < 0 ? last : position - 1, ArrowUp: position < 0 ? last : position - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onSelect(peaks[Math.max(0, Math.min(last, next))].index);
  };
  let data: ReturnType<typeof plotVibrationalSpectrum> | null = null, error: string | null = null;
  try { data = plotVibrationalSpectrum(sourceModes, kind, options); }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  const x = (frequency: number) => LEFT + (frequency - options.axisStartCm1) / (options.axisEndCm1 - options.axisStartCm1) * (WIDTH - LEFT - RIGHT);
  let yMin = 0, yMax = kind === "ir" ? 102 : 1;
  if (data) for (let i = 0; i < data.smoothed.length; i++) {
    yMin = Math.min(yMin, data.smoothed[i], showRaw ? data.raw[i] : 0);
    yMax = Math.max(yMax, data.smoothed[i], showRaw ? data.raw[i] : 0);
  }
  const y = (value: number) => TOP + (yMax - value) / (yMax - yMin) * (HEIGHT - TOP - BOTTOM);
  const path = data ? Array.from(data.smoothed, (value, i) => `${i ? "L" : "M"}${x(data.wavenumbers[i]).toFixed(2)} ${y(value).toFixed(2)}`).join(" ") : null;
  const baseline = kind === "ir" ? 100 : 0;
  const rawPath = data && showRaw ? Array.from(data.raw, (value, i) => value === baseline ? "" : `M${x(data.wavenumbers[i]).toFixed(2)} ${y(baseline).toFixed(2)} L${x(data.wavenumbers[i]).toFixed(2)} ${y(value).toFixed(2)}`).join(" ") : null;
  const sourceUnit = kind === "ir" ? "km/mol" : "Å⁴/amu";
  const label = kind === "ir" ? "Relative transmission (%)" : "Raman activity (Å⁴/amu)";
  const fields: { key: keyof VibrationalPlotOptions; label: string; min: number; max: number; step: number; title?: string }[] = [
    { key: "fwhmCm1", label: "FWHM, cm⁻¹", min: .01, max: 500, step: 1 },
    { key: "scale", label: "Scale factor", min: .01, max: 100, step: .001, title: "Displayed frequency = (source frequency − offset) / scale factor" },
    { key: "offsetCm1", label: "Offset, cm⁻¹", min: -20000, max: 20000, step: 1 },
    { key: "axisStartCm1", label: "Axis start, cm⁻¹", min: 0, max: 20000, step: 1 },
    { key: "axisEndCm1", label: "Axis end, cm⁻¹", min: 0, max: 20000, step: 1 },
  ];
  return <>
    <div className="workbench-row">
      {fields.map(field => <label className="workbench-field" key={field.key} title={field.title}>
        <span>{field.label}</span>
        <ScrubNumberField aria-label={field.label} value={options[field.key]} min={field.min} max={field.max} step={field.step} smallStep={field.step / 10} largeStep={field.step * 10}
          formatValue={value => String(Number(value.toFixed(4)))} onValueChange={value => update(field.key, value)} onValueCommitted={value => update(field.key, value)} />
      </label>)}
      <label className="workbench-switch"><Checkbox checked={showRaw} onCheckedChange={value => setShowRaw(value === true)} />Raw sticks</label>
    </div>
    {error ? <p role="alert" className="workbench-error">{error}</p> : null}
    <figure className="workbench-spectrum workbench-chart" role="slider" tabIndex={0} aria-label={kind === "ir" ? "IR peak" : "Raman peak"}
      aria-valuemin={peaks.length ? 1 : 0} aria-valuemax={peaks.length} aria-valuenow={position >= 0 ? position + 1 : undefined}
      aria-valuetext={current ? `Mode ${current.index}, ${formatFrequency(current)} cm⁻¹, ${kind === "raman" ? "Raman activity " : ""}${quantity(current)!.toFixed(2)} ${sourceUnit}` : "No peak selected"} onKeyDown={onKeyDown}>
      {data ? <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden>
        <line className="workbench-axis" x1={LEFT} x2={WIDTH - RIGHT} y1={y(0)} y2={y(0)} />
        {[options.axisStartCm1, (options.axisStartCm1 + options.axisEndCm1) / 2, options.axisEndCm1].map((tick, i) => <text key={i} className="workbench-tick" x={x(tick)} y={HEIGHT - 4} textAnchor="middle">{Number(tick.toFixed(2))}</text>)}
        {[yMin, yMax].map((tick, i) => <text key={i} className="workbench-tick" x={LEFT - 3} y={y(tick)} textAnchor="end">{Number(tick.toPrecision(3))}</text>)}
        {path ? <path d={path} fill="none" stroke="var(--color-text)" strokeWidth={1.25} /> : null}
        {rawPath ? <path d={rawPath} fill="none" stroke="var(--text-secondary)" strokeWidth={1.25} /> : null}
        {peaks.map(mode => <g key={mode.index} className="workbench-peak" data-selected={mode.index === selected || undefined} onClick={() => onSelect(mode.index)}>
          <rect x={x(center(mode)) - 3} y={TOP} width={6} height={HEIGHT - TOP - BOTTOM}><title>{`${formatFrequency(mode)} cm⁻¹ · ${quantity(mode)} ${sourceUnit}`}</title></rect>
        </g>)}
      </svg> : null}
      <figcaption className="workbench-axis-label" title={kind === "ir" ? "Display transform: 100 × (1 − summed Gaussian intensity / 125). This is not a physical transmittance calculation." : "Gaussian peak height equals the source Raman activity."}>{label} · cm⁻¹</figcaption>
    </figure>
  </>;
}
