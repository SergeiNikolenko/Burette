import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ScientificSpectra, AdditionalSpectrumKind } from "../../lib/molecular-workbench/scientific-spectra";
import { scientificSpectraJson, scientificSpectrumCsv } from "../../lib/molecular-workbench/scientific-spectra";
import { spectralPlotDefaults, spectralPlotSettingsJson, type SpectralPlotOptions, type SpectralPlotSelection } from "../../lib/molecular-workbench/scientific-spectra-plot";
import { ELEMENT_SYMBOLS } from "../../lib/molecular-workbench/elements";
import { computeScientificSpectrum, type ScientificSpectrumPlot, type ScientificSpectrumRequest } from "../../lib/workbench/scientific-spectrum-task";
import { fileStem } from "../../lib/workbench/formats";
import type { ShellActions } from "../types";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ChevronDown } from "../ui/app-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import "./workbench-layout.css";
import "./vibrations.css";

const LABELS: Record<AdditionalSpectrumKind, string> = { vcd: "VCD", mcd: "MCD", nmr: "NMR", electronic: "Electronic absorption", ecd: "Circular dichroism", dos: "Density of states" };
const ROWS_PER_PAGE = 50;
type Source = { key: string; label: string; data: ScientificSpectra };
type Actions = Pick<ShellActions, "saveKetcherExportFile">;

/** Sources remain explicit: a file-wide dataset is never silently substituted for a frame. */
export function ScientificSpectraPanel({ sources, actions }: { sources: Source[]; actions: Actions }) {
  const [chosen, setChosen] = useState(sources[0]?.key);
  const source = sources.find(value => value.key === chosen) ?? sources[0];
  if (!source) return null;
  return <div className="dock-content workbench-panel">
    {sources.length > 1 ? <NativeSelect size="sm" aria-label="Spectrum source" value={source.key} onChange={event => setChosen(event.currentTarget.value)}>
      {sources.map(value => <NativeSelectOption key={value.key} value={value.key}>{value.label}</NativeSelectOption>)}
    </NativeSelect> : null}
    <SourceSpectra key={source.key} data={source.data} actions={actions} />
  </div>;
}

function SourceSpectra({ data, actions }: { data: ScientificSpectra; actions: Actions }) {
  const [chosen, setChosen] = useState<AdditionalSpectrumKind>(data.spectra[0].kind);
  const spectrum = data.spectra.find(value => value.kind === chosen) ?? data.spectra[0];
  const elements = spectrum.kind === "nmr" ? [...new Set(spectrum.atomIndices.map(index => data.atomicNumbers[index]))].sort((a, b) => a - b) : [];
  const [element, setElement] = useState(elements[0]);
  const atomicNumber = elements.includes(element) ? element : elements[0];
  const selection: SpectralPlotSelection = spectrum.kind === "nmr" ? { kind: "nmr", atomicNumber } : { kind: spectrum.kind };
  return <>
    <div className="workbench-row">
      <NativeSelect size="sm" aria-label="Spectrum" value={spectrum.kind} onChange={event => setChosen(event.currentTarget.value as AdditionalSpectrumKind)}>
        {data.spectra.map(value => <NativeSelectOption key={value.kind} value={value.kind}>{LABELS[value.kind]}</NativeSelectOption>)}
      </NativeSelect>
      {spectrum.kind === "nmr" ? <NativeSelect size="sm" aria-label="NMR element" value={atomicNumber} onChange={event => setElement(Number(event.currentTarget.value))}>
        {elements.map(value => <NativeSelectOption key={value} value={value}>{ELEMENT_SYMBOLS[value - 1]}</NativeSelectOption>)}
      </NativeSelect> : null}
    </div>
    <SpectrumView key={`${spectrum.kind}:${atomicNumber ?? ""}`} data={data} selection={selection} actions={actions} />
  </>;
}

type Run = { request: ScientificSpectrumRequest; plot: ScientificSpectrumPlot | null; status: "running" | "ready" | "cancelled" | "error"; error: string | null };
function SpectrumView({ data, selection, actions }: { data: ScientificSpectra; selection: SpectralPlotSelection; actions: Actions }) {
  const [options, setOptions] = useState(() => spectralPlotDefaults(selection));
  const [showRaw, setShowRaw] = useState(true), [selected, setSelected] = useState<string | null>(null), [page, setPage] = useState(0), [retry, setRetry] = useState(0);
  const [run, setRun] = useState<Run | null>(null), [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const request = useMemo(() => ({ data, selection, options }), [data, selection.kind, selection.kind === "nmr" ? selection.atomicNumber : null, options]);
  useEffect(() => {
    const abort = new AbortController(); pending.current = abort;
    setRun({ request, plot: null, status: "running", error: null });
    void computeScientificSpectrum(request, { signal: abort.signal }).then(plot => {
      if (!abort.signal.aborted) setRun({ request, plot, status: "ready", error: null });
    }).catch(() => { if (!abort.signal.aborted) setRun({ request, plot: null, status: "error", error: "Cannot draw this range. Reduce the range or adjust the display settings." }); });
    return () => { abort.abort(); };
  }, [request, retry]);
  const current = run?.request === request ? run : null, plot = current?.plot ?? null;
  const busy = !current || current.status === "running";
  const spectrum = data.spectra.find(value => value.kind === selection.kind)!;
  const unit = selection.kind === "nmr" ? "ppm" : selection.kind === "vcd" || selection.kind === "mcd" ? "cm⁻¹" : "eV";
  const fields: { key: keyof SpectralPlotOptions; label: string; min: number; max: number; step: number }[] = [
    { key: "fwhm", label: `FWHM, ${unit}`, min: .01, max: 20000, step: .01 },
    { key: "scale", label: "Scale factor", min: .0001, max: 1000, step: .001 },
    { key: "offset", label: `${selection.kind === "nmr" ? "Reference" : "Offset"}, ${unit}`, min: -200000, max: 200000, step: .01 },
    { key: "axisStart", label: `Axis start, ${unit}`, min: -200000, max: 200000, step: 1 },
    { key: "axisEnd", label: `Axis end, ${unit}`, min: -200000, max: 200000, step: 1 },
  ];
  const rows = plot?.sourceRowIndices ?? [];
  const id = (row: number) => spectrum.kind === "nmr" ? `atom:${spectrum.atomIndices[row]}` : spectrum.sourceRowIds?.[row] ?? `row:${row}`;
  const label = (row: number) => spectrum.kind === "nmr" ? `${ELEMENT_SYMBOLS[data.atomicNumbers[spectrum.atomIndices[row]] - 1]}${spectrum.atomIndices[row] + 1}` : spectrum.sourceRowIds?.[row] ?? String(row + 1);
  const choose = (row: number) => { setSelected(id(row)); setPage(Math.floor(rows.indexOf(row) / ROWS_PER_PAGE)); };
  const low = Math.min(options.axisStart, options.axisEnd), high = Math.max(options.axisStart, options.axisEnd);
  const peaks = plot ? plot.peaks.map((peak, index) => ({ ...peak, row: rows[index] })).filter(peak => peak.center >= low && peak.center <= high)
    .sort((a, b) => Math.sign(options.axisEnd - options.axisStart) * (a.center - b.center)) : [];
  const selectedPeak = peaks.findIndex(peak => id(peak.row) === selected);
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!peaks.length) return;
    const last = peaks.length - 1;
    const next = { ArrowRight: selectedPeak + 1, ArrowDown: selectedPeak + 1, ArrowLeft: selectedPeak < 0 ? last : selectedPeak - 1, ArrowUp: selectedPeak < 0 ? last : selectedPeak - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return; event.preventDefault(); choose(peaks[Math.max(0, Math.min(last, next))].row);
  };
  const save = (kind: "csv" | "json" | "settings") => {
    setSaveError(null);
    try {
      const text = kind === "csv" ? scientificSpectrumCsv(data, selection.kind) : kind === "json" ? scientificSpectraJson(data) : spectralPlotSettingsJson(plot!);
      const extension = kind === "csv" ? "csv" : "json", scope = data.source.scope === "frame" ? `-frame-${data.source.frameIndex + 1}` : "";
      void actions.saveKetcherExportFile({ title: `${fileStem(data.source.name)}${scope}-${selection.kind}${kind === "settings" ? "-display" : ""}.${extension}`, extension, text })
        .catch(() => setSaveError("Could not save the spectrum. Try again."));
    } catch { setSaveError("Could not save the spectrum. Try again."); }
  };
  return <>
    <div className="workbench-row">
      {fields.map(field => <label className="workbench-field" key={field.key} title={field.key === "offset" && selection.kind === "nmr" ? "Reference is an approximate starting value; set the reference for your calculation. Shift = (reference − source ppm) / scale." : undefined}>
        <span>{field.label}</span><ScrubNumberField aria-label={field.label} value={options[field.key]} min={field.min} max={field.max} step={field.step} smallStep={field.step / 10} largeStep={field.step * 10}
          formatValue={value => String(Number(value.toFixed(4)))} onValueChange={value => setOptions(previous => ({ ...previous, [field.key]: value }))} onValueCommitted={value => setOptions(previous => previous[field.key] === value ? previous : ({ ...previous, [field.key]: value }))} />
      </label>)}
    </div>
    <div className="workbench-row">
      <label className="workbench-switch"><Checkbox checked={showRaw} onCheckedChange={value => setShowRaw(value === true)} />Raw sticks</label>
      {busy ? <Button size="xs" variant="ghost" onClick={() => { pending.current?.abort(); setRun({ request, plot: null, status: "cancelled", error: null }); }}>Cancel</Button>
        : current?.status !== "ready" ? <Button size="xs" onClick={() => setRetry(value => value + 1)}>Calculate</Button> : null}
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="xs" variant="ghost">Export<ChevronDown aria-hidden /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => save("csv")}>Source CSV</DropdownMenuItem><DropdownMenuItem onSelect={() => save("json")}>Source JSON</DropdownMenuItem>
          <DropdownMenuItem disabled={!plot} onSelect={() => save("settings")}>Display settings</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
    </div>
    {busy ? <span role="status">Calculating spectrum</span> : null}
    {current?.error || saveError ? <p role="alert" className="workbench-error">{current?.error || saveError}</p> : null}
    {plot ? <>
      <figure className="workbench-spectrum workbench-chart" role={peaks.length ? "slider" : "img"} tabIndex={peaks.length ? 0 : -1} aria-label={`${LABELS[selection.kind]} peak`} aria-valuemin={peaks.length ? 0 : undefined} aria-valuemax={peaks.length || undefined}
        aria-valuenow={peaks.length ? selectedPeak + 1 : undefined} aria-valuetext={!peaks.length ? undefined : selectedPeak < 0 ? "No peak selected" : `${label(peaks[selectedPeak].row)}, ${peaks[selectedPeak].center.toPrecision(6)} ${unit}`} onKeyDown={keyboard}>
        <ScientificPlot plot={plot} raw={showRaw} selected={peaks[selectedPeak]?.center} onPick={position => {
          const nearest = peaks.reduce<typeof peaks[number] | null>((best, peak) => !best || Math.abs(peak.center - position) < Math.abs(best.center - position) ? peak : best, null);
          if (nearest) choose(nearest.row);
        }} />
        <figcaption className="workbench-axis-label">{unit}{spectrum.kind !== "nmr" && spectrum.valueUnit ? ` · ${spectrum.valueUnit}` : ""}</figcaption>
      </figure>
      <div className="overflow-x-auto"><table className="workbench-table" aria-label={`${LABELS[selection.kind]} source values`}><thead><tr><th scope="col">{spectrum.kind === "nmr" ? "Atom" : "Row"}</th>
        <th scope="col">{spectrum.kind === "nmr" ? `Source ${spectrum.quantity === "isotropic-shielding" ? "shielding" : "value"}, ppm` : `Position, ${spectrum.xUnit}`}</th>
        {spectrum.kind !== "nmr" ? <th scope="col">Signal{spectrum.valueUnit ? `, ${spectrum.valueUnit}` : ""}</th> : null}{spectrum.auxiliary?.map(column => <th scope="col" key={column.name}>{column.name}{column.unit ? `, ${column.unit}` : ""}</th>)}</tr></thead><tbody>
        {rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE).map(row => <tr key={id(row)} aria-selected={selected === id(row)} data-selectable tabIndex={0} onClick={() => choose(row)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(row); } }}>
          <th scope="row">{label(row)}</th><td>{(spectrum.kind === "nmr" ? spectrum.valuesPpm[row] : spectrum.positions[row]).toPrecision(6)}</td>{spectrum.kind !== "nmr" ? <td>{spectrum.values[row].toPrecision(6)}</td> : null}{spectrum.auxiliary?.map(column => <td key={column.name}>{column.values[row].toPrecision(6)}</td>)}
        </tr>)}
      </tbody></table></div>
      {rows.length > ROWS_PER_PAGE ? <nav aria-label="Spectrum rows" className="workbench-row"><Button size="xs" variant="ghost" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</Button><span>{page + 1} / {Math.ceil(rows.length / ROWS_PER_PAGE)}</span><Button size="xs" variant="ghost" disabled={(page + 1) * ROWS_PER_PAGE >= rows.length} onClick={() => setPage(value => value + 1)}>Next</Button></nav> : null}
    </> : null}
  </>;
}

function ScientificPlot({ plot, raw, selected, onPick }: { plot: ScientificSpectrumPlot; raw: boolean; selected?: number; onPick: (position: number) => void }) {
  const width = 320, height = 120, left = 38, right = 8, top = 8, bottom = 22;
  let low = 0, high = 0;
  for (const index of plot.renderIndices) { low = Math.min(low, plot.smoothed[index], raw ? plot.raw[index] : 0); high = Math.max(high, plot.smoothed[index], raw ? plot.raw[index] : 0); }
  if (low === high) high = low + 1;
  const x = (value: number) => left + (value - plot.axisStart) / (plot.axisEnd - plot.axisStart) * (width - left - right);
  const y = (value: number) => top + (high - value) / (high - low) * (height - top - bottom);
  const path = Array.from(plot.renderIndices, (index, step) => `${step ? "L" : "M"}${x(plot.positions[index]).toFixed(2)} ${y(plot.smoothed[index]).toFixed(2)}`).join(" ");
  const sticks = raw ? Array.from(plot.renderIndices, index => plot.raw[index] === 0 ? "" : `M${x(plot.positions[index]).toFixed(2)} ${y(0).toFixed(2)} L${x(plot.positions[index]).toFixed(2)} ${y(plot.raw[index]).toFixed(2)}`).join(" ") : "";
  return <svg viewBox={`0 0 ${width} ${height}`} aria-hidden onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); if (bounds.width) onPick(plot.axisStart + ((event.clientX - bounds.left) / bounds.width * width - left) / (width - left - right) * (plot.axisEnd - plot.axisStart)); }}>
    <line className="workbench-axis" x1={left} x2={width - right} y1={y(0)} y2={y(0)} />
    {[plot.axisStart, (plot.axisStart + plot.axisEnd) / 2, plot.axisEnd].map((tick, index) => <text key={index} className="workbench-tick" x={x(tick)} y={height - 4} textAnchor="middle">{Number(tick.toPrecision(4))}</text>)}
    {[low, high].map((tick, index) => <text key={index} className="workbench-tick" x={left - 3} y={y(tick)} textAnchor="end">{Number(tick.toPrecision(3))}</text>)}
    <path d={path} fill="none" stroke="var(--color-text)" strokeWidth={1.25} /><path d={sticks} fill="none" stroke="var(--text-secondary)" strokeWidth={1.25} />
    {selected === undefined ? null : <line x1={x(selected)} x2={x(selected)} y1={top} y2={height - bottom} stroke="var(--color-text)" strokeDasharray="3 3" />}
  </svg>;
}
