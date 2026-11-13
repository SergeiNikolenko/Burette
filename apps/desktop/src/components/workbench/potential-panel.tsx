import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { runChemistryTask } from "../../lib/molecular-workbench/compute-client";
import { surfacePotentialLimit, VAN_DER_WAALS_ISOVALUE } from "../../lib/molecular-workbench/electrostatic-potential";
import { parseScientificFile } from "../../lib/molecular-workbench/quantum";
import { computePotentialGrids } from "../../lib/molecular-workbench/quantum-client";
import type { ScalarGrid, ScientificDocument } from "../../lib/molecular-workbench/scientific-types";
import type { MolecularStructure } from "../../lib/molecular-workbench/molecular-graph";
import type { MolecularAtom } from "../../lib/molecular-workbench/types";
import { serializeCube } from "../../lib/workbench/cube-task";
import { scalarSourceIdentity } from "../../lib/workbench/scalar-source";
import { captureViewerActionTarget, type ViewerActionTarget } from "../../lib/viewer-bridge";
import { isAbortError } from "../../lib/viewer-errors";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { Button } from "../ui/button";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { Spinner } from "../ui/spinner";
import { MODEL_NAMES, useSceneFrame } from "./calculation-results-card";
import "./workbench-layout.css";
import "./orbitals.css";
import "./potential.css";

/** Where the potential comes from: atomic charges, or a field on the density cube's grid. */
type Source = { key: string; label: string } & ({ kind: "charges"; values: number[] } | { kind: "gasteiger" } | { kind: "cube"; grid: ScalarGrid });
type Shown = { key: string; cube: string; style: string; lease: string; target: ViewerActionTarget };
// cubegen and GaussView draw the potential on the 0.0004 e/bohr³ density isosurface.
const DENSITY_ISOVALUE = 0.0004;

const sameGrid = (a: ScalarGrid, b: ScalarGrid) => a.dimensions.every((value, i) => value === b.dimensions[i])
  && [...a.origin, ...a.axes.flat()].every((value, i) => Math.abs(value - [...b.origin, ...b.axes.flat()][i]) < 1e-6);
const format = (value: number) => value.toPrecision(2);

export function PotentialPanel({ document, actions, science, sourceText, sourceKind, structure }: {
  document: ViewerDocument;
  actions: ShellActions;
  science: ScientificDocument;
  sourceText: string;
  sourceKind: string;
  /** The source's molecular graph, for Gasteiger charges. */
  structure: MolecularStructure | null;
}) {
  const frame = useSceneFrame(document, science, sourceText);
  const atoms: MolecularAtom[] = frame?.atoms ?? science.atoms;
  const [file, setFile] = useState<{ name: string; grid: ScalarGrid } | null>(null);
  const sources: Source[] = [
    ...(frame?.charges ?? []).map((set): Source => ({ key: `charges:${set.model}`, label: `${MODEL_NAMES[set.model]} charges`, kind: "charges", values: set.values })),
    // Gasteiger needs the bond orders and charges a MOL file states; XYZ only has coordinates.
    ...(structure?.graphComplete && structure.atoms.length === atoms.length && structure.atoms.every((atom, i) => atom.element === atoms[i].element)
      && !frame?.charges?.some((set) => set.model === "gasteiger") ? [{ key: "gasteiger", label: "Gasteiger charges", kind: "gasteiger" } as const] : []),
    ...(science.gridDatasets ?? []).slice(1).map((dataset, i): Source => ({ key: `dataset:${i + 1}`, label: dataset.label, kind: "cube", grid: dataset.grid })),
    ...(file ? [{ key: `file:${file.name}`, label: file.name, kind: "cube", grid: file.grid } as const] : []),
  ];
  const [chosen, setChosen] = useState<string | null>(null);
  const source = sources.find((item) => item.key === chosen) ?? sources[0] ?? null;
  const [isovalue, setIsovalue] = useState(DENSITY_ISOVALUE);
  const [range, setRange] = useState<{ key: string; min: number; max: number } | null>(null);
  const [wanted, setWanted] = useState(false);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useRef<Shown | null>(null);
  const binding = useRef<{ target: ViewerActionTarget; lease: string } | null>(null);
  const sender = useRef(actions.runStructureViewerAction);
  sender.current = actions.runStructureViewerAction;
  const live = useRef({ document, science });
  live.current = { document, science };
  const current = () => live.current.document === document && live.current.science === science;
  const surfaceIsovalue = source?.kind === "cube" ? isovalue : VAN_DER_WAALS_ISOVALUE;
  const sourceKey = source ? `${source.key}:${source.kind === "cube" ? "" : atoms.map((atom) => `${atom.x},${atom.y},${atom.z}`).join(";")}` : null;
  const colors = range?.key === sourceKey ? range : null;

  const send = (cube: string, target: ViewerActionTarget, lease: string, coloring?: { min: number; max: number }, value = surfaceIsovalue) =>
    sender.current(document, { type: "show_scalar_field", lease, label: "Electrostatic potential", cube, isovalue: value, signed: false, alpha: 0.9, ...(coloring ? { coloring } : {}), notify: false }, { target });

  // Clears through the retained scene when the panel goes away.
  useEffect(() => () => {
    const value = shown.current; shown.current = null;
    if (value) void Promise.resolve(send("", value.target, value.lease)).catch(() => {});
  }, [document, science]);

  // Computes and shows the surface for the chosen source; a newer choice aborts the one in flight.
  useEffect(() => {
    if (!wanted || !source || !sourceKey || shown.current?.key === sourceKey) return undefined;
    const target = binding.current?.target.isCurrent() ? binding.current.target : captureViewerActionTarget(document.id);
    if (!target) { setError("Open the scene and wait for it to load."); setWanted(false); return undefined; }
    const controller = new AbortController(), { signal } = controller;
    setComputing(true); setError(null);
    void (async () => {
      try {
        let lease = binding.current?.target === target ? binding.current.lease : null;
        if (!lease) {
          const result = await sender.current(document, { type: "scalar_field_binding", label: "Electrostatic potential", expected: await scalarSourceIdentity(science, sourceText, sourceKind), notify: false }, { target, signal });
          if (!result || typeof result !== "object" || !("lease" in result) || typeof result.lease !== "string" || !result.lease) throw new Error("The scene could not bind the scientific source.");
          lease = result.lease;
          binding.current = { target, lease };
        }
        let grids: { surface: ScalarGrid; potential: ScalarGrid };
        if (source.kind === "cube") {
          if (!science.grid || !sameGrid(science.grid, source.grid)) throw new Error("The potential cube needs the same grid as the density cube.");
          grids = { surface: science.grid, potential: source.grid };
        } else {
          const charges = source.kind === "charges" ? source.values : (await runChemistryTask({ action: "charges", molecule: structure! }, { signal })).charges;
          grids = await computePotentialGrids(atoms, charges, signal);
        }
        if (signal.aborted || !current() || !target.isCurrent()) return;
        const limit = surfacePotentialLimit(grids.surface, surfaceIsovalue, grids.potential);
        const coloring = colors ?? { min: -limit, max: limit };
        const cube = await serializeCube([grids.surface, grids.potential], source.kind === "cube" ? science.atoms : atoms, { signal });
        if (signal.aborted || !current() || !target.isCurrent()) return;
        await sender.current(document, { type: "scalar_field_validate", lease, label: "Electrostatic potential", notify: false }, { target, signal });
        await send(cube, target, lease, coloring);
        shown.current = { key: sourceKey, cube, style: `${coloring.min}:${coloring.max}:${surfaceIsovalue}`, lease, target };
        if (!colors) setRange({ key: sourceKey, ...coloring });
      } catch (caught) {
        if (!isAbortError(caught) && !signal.aborted && current()) { binding.current = null; setError(caught instanceof Error ? caught.message : String(caught)); setWanted(false); }
      } finally {
        if (!signal.aborted) setComputing(false);
      }
    })();
    return () => { controller.abort(); setComputing(false); };
  }, [wanted, sourceKey, document, science]);

  // A new range or isovalue redraws the computed cube after the value settles.
  useEffect(() => {
    const value = shown.current, style = colors && `${colors.min}:${colors.max}:${surfaceIsovalue}`;
    if (!wanted || !colors || !value || value.key !== sourceKey || value.style === style) return undefined;
    const timer = window.setTimeout(() => {
      if (!current() || !value.target.isCurrent() || shown.current !== value) return;
      value.style = style!;
      void Promise.resolve(send(value.cube, value.target, value.lease, { min: colors.min, max: colors.max })).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [colors?.min, colors?.max, surfaceIsovalue]);

  const hide = () => {
    setWanted(false);
    const value = shown.current; shown.current = null;
    if (value) void Promise.resolve(send("", value.target, value.lease)).catch(() => {});
  };

  const openCube = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    try {
      const cube = parseScientificFile(picked.name, await picked.text());
      if (!cube.grid) throw new Error("This file has no Cube grid.");
      setFile({ name: picked.name, grid: cube.grid });
      setChosen(`file:${picked.name}`);
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  const fileInput = useRef<HTMLInputElement>(null);
  const setLimit = (side: "min" | "max", value: number) => setRange((previous) => previous && previous.key === sourceKey
    && (side === "min" ? value < previous.max : value > previous.min) ? { ...previous, [side]: value } : previous);

  return (
    <div className="dock-content workbench-panel potential-panel">
      <div className="workbench-controls">
        <div className="workbench-row">
          {sources.length ? (
            <label className="workbench-field">
              <span>Potential</span>
              <NativeSelect size="sm" aria-label="Potential" value={source?.key ?? ""} onChange={(event) => setChosen(event.target.value)}>
                {sources.map((item) => <NativeSelectOption key={item.key} value={item.key}>{item.label}</NativeSelectOption>)}
              </NativeSelect>
            </label>
          ) : null}
          {science.grid ? (
            <>
              <label className="workbench-field">
                <span>Isovalue, e/bohr³</span>
                <ScrubNumberField aria-label="Isovalue, e/bohr³" value={isovalue} min={0.00001} max={1} step={0.0001} smallStep={0.00001} largeStep={0.001}
                  formatValue={(value) => value.toPrecision(2)} onValueChange={setIsovalue} onValueCommitted={setIsovalue} />
              </label>
              <input ref={fileInput} type="file" accept=".cube,.cub" hidden onChange={(event) => void openCube(event)} />
              <Button type="button" variant="ghost" size="xs" onClick={() => fileInput.current?.click()}>Open potential cube</Button>
            </>
          ) : null}
          <div className="workbench-actions">
            {computing ? (
              <>
                <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Calculating</span>
                <Button type="button" variant="ghost" size="xs" onClick={hide}>Cancel</Button>
              </>
            ) : wanted ? (
              <Button type="button" variant="secondary" size="xs" onClick={hide}>Hide surface</Button>
            ) : (
              <Button type="button" size="xs" disabled={!source} onClick={() => setWanted(true)}>Show surface</Button>
            )}
          </div>
        </div>
        {colors ? (
          <div className="workbench-field">
            <span>Colour range, a.u.</span>
            <div className="potential-range">
              <ScrubNumberField aria-label="Most negative potential, a.u." value={colors.min} min={-10} max={10} step={0.005} smallStep={0.001} largeStep={0.05}
                formatValue={format} onValueChange={(value) => setLimit("min", value)} onValueCommitted={(value) => setLimit("min", value)} />
              <span className="potential-legend" aria-hidden />
              <ScrubNumberField aria-label="Most positive potential, a.u." value={colors.max} min={-10} max={10} step={0.005} smallStep={0.001} largeStep={0.05}
                formatValue={format} onValueChange={(value) => setLimit("max", value)} onValueCommitted={(value) => setLimit("max", value)} />
            </div>
          </div>
        ) : null}
        {error ? <p role="alert" className="workbench-error">{error}</p> : null}
      </div>
    </div>
  );
}
