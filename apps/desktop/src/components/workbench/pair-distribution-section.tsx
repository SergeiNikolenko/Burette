import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  PAIR_DISTRIBUTION_DEFAULTS, PAIR_DISTRIBUTION_LIMITS, pairDistributionCsv, pairDistributionJson,
  pairDistributionSettingsProblem, selectPairs, type PairDistribution, type SpeciesSelection,
} from "../../lib/molecular-workbench/pair-distribution/pair-distribution";
import { runPairDistributionTask } from "../../lib/molecular-workbench/pair-distribution/pair-distribution-client";
import type { MolecularAtom, UnitCell } from "../../lib/molecular-workbench/types";
import { fileStem } from "../../lib/workbench/formats";
import type { ShellActions } from "../types";
import { Button } from "../ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart";
import { ChevronDown } from "../ui/app-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { Spinner } from "../ui/spinner";
import { useCancellableJob } from "./use-workbench-source";
import "./vibrations.css";
import "./crystal.css";

/** The histogram includes every ordered element pair; changing species only selects that existing result. */
export function PairDistributionSection({ title, atoms, cell, revision, actions }: { title: string; atoms: MolecularAtom[]; cell: UnitCell; revision: string; actions: ShellActions }) {
  const [settings, setSettings] = useState<{ rMax: number; binWidth: number }>(PAIR_DISTRIBUTION_DEFAULTS);
  const [result, setResult] = useState<{ key: string; value: PairDistribution } | null>(null);
  const [centre, setCentre] = useState<SpeciesSelection>(null);
  const [neighbour, setNeighbour] = useState<SpeciesSelection>(null);
  const [saveError, setSaveError] = useState<{ key: string; message: string } | null>(null);
  const job = useCancellableJob(revision);
  const key = `${revision}:${settings.rMax}:${settings.binWidth}`;
  const current = result?.key === key ? result.value : null;
  const problem = pairDistributionSettingsProblem(settings);
  const selection = useMemo(() => current ? selectPairs(current, centre && current.species.includes(centre) ? centre : null,
    neighbour && current.species.includes(neighbour) ? neighbour : null) : null, [current, centre, neighbour]);
  const data = useMemo(() => current && selection ? Array.from(selection.g, (g, index) => ({ r: (index + 0.5) * current.binWidth, g })) : [], [current, selection]);
  const update = (next: Partial<typeof settings>) => { job.cancel(); job.setError(null); setSaveError(null); setSettings({ ...settings, ...next }); };
  const calculate = async () => {
    if (problem) return;
    setSaveError(null);
    const value = await job.run("Calculating g(r)", (signal) => runPairDistributionTask({ atoms, cell, ...settings }, { signal }));
    if (value) setResult({ key, value });
  };
  const save = async (kind: "csv" | "json") => {
    if (!current || !selection) return;
    setSaveError(null);
    try {
      const context = { title, engine: "Burette periodic radial distribution 1" };
      const text = kind === "csv" ? pairDistributionCsv(current, selection, context) : pairDistributionJson(current, selection, context);
      const outcome = await actions.saveKetcherExportFile({ title: `${fileStem(title)}-gr.${kind}`, extension: kind, text });
      if (outcome.status === "failed") setSaveError({ key, message: "Could not save the pair distribution. Try exporting again." });
    } catch { setSaveError({ key, message: "Could not save the pair distribution. Try exporting again." }); }
  };
  const speciesField = (label: string, value: SpeciesSelection, set: (next: SpeciesSelection) => void) => (
    <label className="workbench-field">
      <span>{label}</span>
      <NativeSelect size="sm" name={label.toLowerCase()} aria-label={label} autoComplete="off" value={value && current?.species.includes(value) ? value : ""} onChange={(event) => { setSaveError(null); set(event.currentTarget.value || null); }}>
        <NativeSelectOption value="">All elements</NativeSelectOption>
        {current?.species.map((element) => <NativeSelectOption key={element} value={element}>{element}</NativeSelectOption>)}
      </NativeSelect>
    </label>
  );
  const error = problem ?? job.error ?? (saveError?.key === key ? saveError.message : null);
  return (
    <section className="workbench-form" aria-label="Radial distribution g(r)">
      <div className="workbench-row">
        <label className="workbench-field">
          <span>r max, Å</span>
          <ScrubNumberField name="r-max" autoComplete="off" aria-label="r max, Å" value={settings.rMax} {...PAIR_DISTRIBUTION_LIMITS.rMax} step={0.5} largeStep={5}
            formatValue={(value) => value.toFixed(2)} onValueChange={(rMax) => update({ rMax })} onValueCommitted={(rMax) => update({ rMax })} />
        </label>
        <label className="workbench-field">
          <span>Bin width, Å</span>
          <ScrubNumberField name="bin-width" autoComplete="off" aria-label="Bin width, Å" value={settings.binWidth} {...PAIR_DISTRIBUTION_LIMITS.binWidth} step={0.01} smallStep={0.001} largeStep={0.1}
            formatValue={(value) => value.toFixed(3)} onValueChange={(binWidth) => update({ binWidth })} onValueCommitted={(binWidth) => update({ binWidth })} />
        </label>
        <div className="workbench-actions">
          {job.running ? <><span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />{job.running}</span><Button type="button" size="xs" variant="secondary" onClick={job.cancel}>Cancel</Button></>
            : <Button type="button" size="xs" disabled={Boolean(problem)} onClick={() => void calculate()}>Calculate</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" size="xs" variant="ghost" disabled={!current || Boolean(job.running)}>Export<ChevronDown aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void save("csv")}>g(r) as CSV</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void save("json")}>Pair distribution as JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error ? <p role="alert" className="workbench-error">{error}</p> : null}
      {current && selection ? <>
        <div className="workbench-row">
          {speciesField("Centre", selection.centre, setCentre)}
          {speciesField("Neighbour", selection.neighbour, setNeighbour)}
          {Number.isFinite(selection.minDistance) ? <span className="workbench-value">Nearest {selection.minDistance.toFixed(3)} Å</span> : null}
          <span className="workbench-value">N({current.rMax.toFixed(2)} Å) = {selection.coordination.at(-1)?.toFixed(3)}</span>
        </div>
        <figure className="workbench-spectrum" aria-label={`g(r), ${selection.centre ?? "all elements"} to ${selection.neighbour ?? "all elements"}`}>
          <ChartContainer config={{ g: { label: "g(r)", color: "var(--color-text)" } }} className="aspect-auto h-44 w-full">
            <LineChart data={data} accessibilityLayer margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="r" type="number" domain={[0, current.rMax]} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis width={48} domain={[0, "auto"]} tickLine={false} axisLine={false} label={{ value: "g(r)", angle: -90, position: "insideLeft" }} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => `r = ${Number(value).toFixed(3)} Å`} />} />
              <Line type="step" dataKey="g" name="g(r)" stroke="var(--color-g)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
          <figcaption className="workbench-axis-label">r, Å</figcaption>
        </figure>
      </> : null}
    </section>
  );
}
