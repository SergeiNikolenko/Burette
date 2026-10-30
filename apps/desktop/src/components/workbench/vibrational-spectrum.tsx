import { useMemo, useState, type KeyboardEvent } from "react";
import type { VibrationalMode } from "../../lib/molecular-workbench/scientific-types";
import { broadenSpectrum, type LineShape } from "../../lib/molecular-workbench/vibrational-spectrum";
import { formatFrequency } from "../../lib/workbench/vibrational-modes";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { VibrationalPlot } from "./vibrational-plot";
const WIDTH = 320;
const HEIGHT = 96;
const PAD = { left: 6, right: 6, top: 6, bottom: 18 };

// Older ORCA versions print only the squared transition dipole (a.u.) per mode;
// it is the IR quantity only when no km/mol intensities exist, and is never
// converted into km/mol. ORCA's Raman activity is not an experimental intensity.
type SpectrumQuantity = { id: "ir" | "t2" | "raman"; option: string; label: string; unit: string; value: (mode: VibrationalMode) => number | undefined; format: (value: number) => string };
const SPECTRUM_QUANTITIES: SpectrumQuantity[] = [
  { id: "ir", option: "IR, km/mol", label: "IR peak", unit: "km/mol", value: (mode) => mode.intensityKmMol, format: (value) => `${value.toFixed(2)} km/mol` },
  { id: "t2", option: "T², a.u.", label: "Transition dipole peak", unit: "T², a.u.", value: (mode) => mode.transitionDipoleSquared, format: (value) => `T² ${value.toExponential(2)} a.u.` },
  { id: "raman", option: "Raman activity, Å⁴/amu", label: "Raman peak", unit: "Raman activity, Å⁴/amu", value: (mode) => mode.ramanActivityAngstrom4Amu, format: (value) => `Raman activity ${value.toFixed(2)} Å⁴/amu` },
];

const spectrumPeaks = (modes: VibrationalMode[], quantity: SpectrumQuantity) => modes.filter((mode) => mode.frequencyCm1 > 0 && (quantity.value(mode) ?? 0) > 0);

function spectrumQuantities(modes: VibrationalMode[]) {
  const drawable = SPECTRUM_QUANTITIES.filter((quantity) => spectrumPeaks(modes, quantity).length > 0);
  return drawable.some((quantity) => quantity.id === "ir") ? drawable.filter((quantity) => quantity.id !== "t2") : drawable;
}

// A broadened spectrum: each stick at scale × ν becomes a unit-area line of this width.
type Broadening = { shape: "sticks" | LineShape; fwhmCm1: number; scale: number };
const LINE_SHAPES = { sticks: "Sticks", gaussian: "Area-normalized Gaussian", lorentzian: "Area-normalized Lorentzian" } as const;
const CURVE_POINTS = 400;
// The line shape survives frame changes and tab switches, like the chosen mode.
let rememberedDisplay = "height";
let rememberedBroadening: Broadening = { shape: "sticks", fwhmCm1: 20, scale: 1 };

/** The spectra this geometry's modes can draw; a choice appears only when there is more than one. */
export function VibrationalSpectrum({ modes, sourceModes = modes, selected, onSelect }: { modes: VibrationalMode[]; sourceModes?: VibrationalMode[]; selected: number | null; onSelect: (index: number) => void }) {
  const quantities = useMemo(() => spectrumQuantities(modes), [modes]);
  const [display, setDisplay] = useState(rememberedDisplay);
  const [chosen, setChosen] = useState<SpectrumQuantity["id"] | null>(null);
  const [broadening, setBroadening] = useState(rememberedBroadening);
  const quantity = quantities.find((item) => item.id === chosen) ?? quantities[0];
  if (!quantity) return null;
  const faithful = display === "height" && quantity.id !== "t2";
  const update = (next: Partial<Broadening>) => {
    rememberedBroadening = { ...broadening, ...next };
    setBroadening(rememberedBroadening);
  };
  return (
    <div className="workbench-form">
      <div className="workbench-chart-header">
        {quantities.length > 1 ? (
          <NativeSelect size="sm" aria-label="Spectrum" value={quantity.id} onChange={(event) => setChosen(event.currentTarget.value as SpectrumQuantity["id"])}>
            {quantities.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.option}</NativeSelectOption>)}
          </NativeSelect>
        ) : null}
        <span className="workbench-actions">
          <NativeSelect size="sm" aria-label="Spectrum display" value={faithful ? "height" : "area"} onChange={event => { rememberedDisplay = event.currentTarget.value; setDisplay(rememberedDisplay); }}>
            {quantity.id !== "t2" ? <NativeSelectOption value="height">Gaussian peak height</NativeSelectOption> : null}
            <NativeSelectOption value="area">Sticks and area-normalized lines</NativeSelectOption>
          </NativeSelect>
          {!faithful ? <NativeSelect size="sm" aria-label="Line shape" value={broadening.shape} onChange={(event) => update({ shape: event.currentTarget.value as Broadening["shape"] })}>
            {(Object.keys(LINE_SHAPES) as Broadening["shape"][]).map((shape) => <NativeSelectOption key={shape} value={shape}>{LINE_SHAPES[shape]}</NativeSelectOption>)}
          </NativeSelect> : null}
        </span>
      </div>
      {!faithful && broadening.shape !== "sticks" ? (
        <div className="workbench-row">
          <label className="workbench-field">
            <span>FWHM, cm⁻¹</span>
            <ScrubNumberField aria-label="FWHM, cm⁻¹" value={broadening.fwhmCm1} min={1} max={500} step={1} smallStep={0.5} largeStep={10}
              formatValue={(value) => value.toFixed(1)} onValueChange={(value) => update({ fwhmCm1: value })} onValueCommitted={(value) => update({ fwhmCm1: value })} />
          </label>
          <label className="workbench-field">
            <span>Frequency scale</span>
            <ScrubNumberField aria-label="Frequency scale" value={broadening.scale} min={0.5} max={1.5} step={0.001} smallStep={0.0001} largeStep={0.01}
              formatValue={(value) => value.toFixed(4)} onValueChange={(value) => update({ scale: value })} onValueCommitted={(value) => update({ scale: value })} />
          </label>
        </div>
      ) : null}
      {faithful ? <VibrationalPlot key={quantity.id} modes={modes} sourceModes={sourceModes} kind={quantity.id === "ir" ? "ir" : "raman"} selected={selected} onSelect={onSelect} />
        : <SpectrumChart modes={modes} quantity={quantity} broadening={broadening} selected={selected} onSelect={onSelect} />}
    </div>
  );
}

const MAX_TICKS = 9;

/**
 * The axis runs from 0 to `extent` rounded up to 500 cm⁻¹, labelled every 500 or
 * 1000 cm⁻¹. A source frequency far past the infrared only coarsens the label step
 * to 1, 2 or 5 × 10ⁿ, so the label count never depends on the value's magnitude.
 * Null when the drawn range is not a finite number.
 */
function wavenumberAxis(extent: number) {
  const end = Math.ceil(extent / 500) * 500;
  if (!Number.isFinite(end) || end <= 0) return null;
  // The tolerance keeps a tick that lands on the end despite rounding (1e308 / 2e307 = 4.999…).
  const intervals = (step: number) => Math.floor(end / step + 1e-9);
  let step = end <= 2000 ? 500 : 1000;
  if (intervals(step) + 1 > MAX_TICKS) {
    const least = end / (MAX_TICKS - 1);
    const power = 10 ** Math.floor(Math.log10(least));
    step = [1, 2, 5, 10].map((mantissa) => mantissa * power).find((candidate) => candidate >= least)!;
  }
  const count = Math.min(MAX_TICKS, intervals(step) + 1);
  return { end, ticks: Array.from({ length: count }, (_, index) => Number((index * step).toPrecision(12))) };
}

/**
 * Sticks on a decreasing wavenumber axis. Clicking a peak selects its mode; with
 * focus on the spectrum, Left and Right move to the neighbouring peak as drawn.
 * A broadened curve and its sticks are each drawn relative to their own maximum.
 */
function SpectrumChart({ modes, quantity, broadening, selected, onSelect }: { modes: VibrationalMode[]; quantity: SpectrumQuantity; broadening: Broadening; selected: number | null; onSelect: (index: number) => void }) {
  const peaks = spectrumPeaks(modes, quantity).sort((a, b) => b.frequencyCm1 - a.frequencyCm1);
  const intensity = (mode: VibrationalMode) => quantity.value(mode)!;
  const position = peaks.findIndex((mode) => mode.index === selected);
  const current = position >= 0 ? peaks[position] : null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const last = peaks.length - 1;
    const next = { ArrowRight: position + 1, ArrowDown: position + 1, ArrowLeft: position < 0 ? last : position - 1, ArrowUp: position < 0 ? last : position - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onSelect(peaks[Math.max(0, Math.min(last, next))].index);
  };
  const maxIntensity = Math.max(...peaks.map(intensity));
  const broadened = broadening.shape !== "sticks";
  const scale = broadened ? broadening.scale : 1;
  const drawnAt = (mode: VibrationalMode) => scale * mode.frequencyCm1;
  const axis = wavenumberAxis(Math.max(...peaks.map((mode) => drawnAt(mode) + (broadened ? 2 * broadening.fwhmCm1 : 0))));
  if (!axis) return <p role="alert" className="workbench-error">A frequency is too large to draw on the wavenumber axis.</p>;
  const { end: maxFrequency, ticks } = axis;
  const x = (frequency: number) => PAD.left + (1 - frequency / maxFrequency) * (WIDTH - PAD.left - PAD.right);
  const y = (intensity: number) => HEIGHT - PAD.bottom - intensity / maxIntensity * (HEIGHT - PAD.top - PAD.bottom);
  // Supplemental curves retain area units; sticks are not overlaid on their different y units.
  const curve = broadened ? broadenSpectrum(peaks.map((mode) => ({ frequencyCm1: mode.frequencyCm1, value: intensity(mode) })), broadening.shape as LineShape,
    broadening.fwhmCm1, broadening.scale, 0, maxFrequency, CURVE_POINTS) : null;
  const curveMax = curve ? Math.max(...curve.values) : 0;
  if (curve && (!Number.isFinite(curveMax) || !curve.values.every(Number.isFinite))) return <p role="alert" className="workbench-error">The spectrum intensity exceeds the finite plotting range.</p>;
  const curvePath = curve && curveMax > 0 ? Array.from(curve.values, (value, index) =>
    `${index ? "L" : "M"}${x(curve.wavenumbers[index]).toFixed(2)} ${(HEIGHT - PAD.bottom - value / curveMax * (HEIGHT - PAD.top - PAD.bottom)).toFixed(2)}`).join("") : null;
  return (
    <figure className="workbench-spectrum workbench-chart" role="slider" tabIndex={0} aria-label={quantity.label}
      aria-valuemin={1} aria-valuemax={peaks.length} aria-valuenow={position >= 0 ? position + 1 : undefined}
      aria-valuetext={current ? `Mode ${current.index}, ${formatFrequency(current)} cm⁻¹, ${quantity.format(intensity(current))}` : "No peak selected"}
      onKeyDown={onKeyDown}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden>
        <line className="workbench-axis" x1={PAD.left} x2={WIDTH - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} />
        {ticks.map((tick) => (
          <text key={tick} className="workbench-tick" x={x(tick)} y={HEIGHT - 4} textAnchor="middle">{tick}</text>
        ))}
        {curvePath ? <path d={curvePath} fill="none" stroke="var(--color-text)" strokeWidth={1.25} /> : null}
        {broadened && curveMax > 0 ? <text className="workbench-axis-label" x={PAD.left} y={PAD.top + 8}>{curveMax.toPrecision(3)}</text> : null}
        {peaks.map((mode) => (
          <g key={mode.index} className="workbench-peak" data-selected={mode.index === selected || undefined} onClick={() => onSelect(mode.index)}>
            {!broadened ? <line x1={x(drawnAt(mode))} x2={x(drawnAt(mode))} y1={HEIGHT - PAD.bottom} y2={y(intensity(mode))} /> : null}
            {/* A wider transparent target keeps thin sticks clickable. */}
            <rect x={x(drawnAt(mode)) - 3} y={PAD.top} width={6} height={HEIGHT - PAD.top - PAD.bottom}>
              <title>{`${formatFrequency(mode)} cm⁻¹ · ${quantity.format(intensity(mode))}`}</title>
            </rect>
          </g>
        ))}
      </svg>
      <figcaption className="workbench-axis-label" aria-hidden>
        {[broadened ? `${quantity.unit} per cm⁻¹ · cm⁻¹` : `cm⁻¹ · ${quantity.unit}`, broadened ? `${LINE_SHAPES[broadening.shape]} FWHM ${broadening.fwhmCm1.toFixed(1)} cm⁻¹` : null,
          broadened && broadening.scale !== 1 ? `×${broadening.scale.toFixed(4)}` : null].filter(Boolean).join(" · ")}
      </figcaption>
    </figure>
  );
}
