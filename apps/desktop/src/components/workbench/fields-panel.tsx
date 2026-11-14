import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { gridToCube, parseScientificFile } from "../../lib/molecular-workbench/quantum";
import { combineGrids, fieldLimit, integrateGrid, sameGrid, sliceGrid, type FieldOperation, type SliceAxis } from "../../lib/molecular-workbench/scalar-field-ops";
import type { ScalarGrid, ScientificDocument } from "../../lib/molecular-workbench/scientific-types";
import { serializeCube } from "../../lib/workbench/cube-task";
import { fileStem } from "../../lib/workbench/formats";
import { openScientificDocument } from "../../lib/workbench/generated-document-open";
import { scalarSourceIdentity } from "../../lib/workbench/scalar-source";
import { captureViewerActionTarget, type ViewerActionTarget } from "../../lib/viewer-bridge";
import { isAbortError } from "../../lib/viewer-errors";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { Button } from "../ui/button";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Slider } from "../ui/slider";
import { FieldSlicePlot } from "./field-slice-plot";
import "./workbench-layout.css";
import "./potential.css";
import "./fields.css";

type Field = { key: string; label: string; grid: ScalarGrid };
type Shown = { lease: string; target: ViewerActionTarget; style: string };
const PLANES: Array<[SliceAxis, string]> = [[2, "XY"], [1, "XZ"], [0, "YZ"]];
const OPERATIONS: Array<[FieldOperation, string]> = [["difference", "A − B"], ["sum", "A + B"], ["scale", "k × A"]];
const NAMES: Record<FieldOperation, string> = { difference: "minus", sum: "plus", scale: "times" };
const format = (value: number) => value.toPrecision(2);

export function FieldsPanel({ document, actions, science, sourceText, sourceKind }: {
  document: ViewerDocument;
  actions: ShellActions;
  science: ScientificDocument;
  sourceText: string;
  sourceKind: string;
}) {
  const stem = fileStem(document.title || document.path);
  const own: Field[] = (science.gridDatasets ?? [{ label: stem, grid: science.grid! }]).map((dataset, i) => ({ key: `own:${i}`, label: dataset.label, grid: dataset.grid }));
  const [opened, setOpened] = useState<Field[]>([]);
  const all = [...own, ...opened];
  const [chosen, setChosen] = useState(own[0].key);
  const field = own.find((item) => item.key === chosen) ?? own[0];
  const [axis, setAxis] = useState<SliceAxis>(2);
  const [index, setIndex] = useState(() => Math.floor(field.grid.dimensions[2] / 2));
  const [contours, setContours] = useState(9);
  const [ranges, setRanges] = useState<Record<string, { min: number; max: number }>>({});
  const limit = useMemo(() => fieldLimit(field.grid.values), [field]);
  const range = ranges[field.key] ?? { min: -limit, max: limit };
  const integral = useMemo(() => integrateGrid(field.grid), [field]);
  const position = Math.min(index, field.grid.dimensions[axis] - 1);
  const slice = useMemo(() => sliceGrid(field.grid, axis, position), [field, axis, position]);
  const offset = useMemo(() => {
    const [u, v] = [slice.u, slice.v];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], length = Math.hypot(...n);
    return (slice.origin[0] * n[0] + slice.origin[1] * n[1] + slice.origin[2] * n[2]) / length;
  }, [slice]);

  const [operation, setOperation] = useState<FieldOperation>("difference");
  const [first, setFirst] = useState(own[0].key);
  const [second, setSecond] = useState<string | null>(null);
  const [factor, setFactor] = useState(2);
  const [wanted, setWanted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shown = useRef<Shown | null>(null);
  const cubes = useRef(new Map<string, Promise<string>>());
  const sender = useRef(actions.runStructureViewerAction);
  sender.current = actions.runStructureViewerAction;

  const setLimit = (side: "min" | "max", value: number) => setRanges((previous) => {
    const current = previous[field.key] ?? { min: -limit, max: limit };
    return (side === "min" ? value < current.max : value > current.min) ? { ...previous, [field.key]: { ...current, [side]: value } } : previous;
  });
  const choosePlane = (value: SliceAxis) => { setAxis(value); setIndex(Math.floor(field.grid.dimensions[value] / 2)); };

  const clear = () => {
    const value = shown.current; shown.current = null;
    if (value) void Promise.resolve(sender.current(document, { type: "show_scalar_field", lease: value.lease, label: field.label, cube: "", isovalue: 1, signed: false, notify: false }, { target: value.target })).catch(() => {});
  };
  useEffect(() => clear, []);

  // The scene shows the plane the plot shows; a newer plane or range replaces the one in flight.
  const style = `${field.key}:${axis}:${position}:${range.min}:${range.max}`;
  useEffect(() => {
    if (!wanted || shown.current?.style === style) return undefined;
    const controller = new AbortController(), { signal } = controller;
    const timer = window.setTimeout(() => void (async () => {
      try {
        const target = shown.current?.target.isCurrent() ? shown.current.target : captureViewerActionTarget(document.id);
        if (!target) throw new Error("Open the scene and wait for it to load.");
        let lease = shown.current?.target === target ? shown.current.lease : null;
        if (!lease) {
          const result = await sender.current(document, { type: "scalar_field_binding", label: field.label, expected: await scalarSourceIdentity(science, sourceText, sourceKind), notify: false }, { target, signal });
          if (!result || typeof result !== "object" || !("lease" in result) || typeof result.lease !== "string" || !result.lease) throw new Error("The scene could not bind the scientific source.");
          lease = result.lease;
        }
        let cube = cubes.current.get(field.key);
        if (!cube) { cube = serializeCube(field.grid, science.atoms); cubes.current.set(field.key, cube); }
        const text = await cube;
        if (signal.aborted || !target.isCurrent()) return;
        await sender.current(document, { type: "scalar_field_validate", lease, label: field.label, notify: false }, { target, signal });
        await sender.current(document, { type: "show_scalar_field", lease, label: field.label, cube: text, isovalue: 1, signed: false, alpha: 0.9,
          slice: { axis, index: position, min: range.min, max: range.max }, notify: false }, { target, signal });
        shown.current = { lease, target, style };
        setError(null);
      } catch (caught) {
        if (isAbortError(caught) || signal.aborted) return;
        cubes.current.delete(field.key);
        shown.current = null;
        setWanted(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    })(), shown.current ? 120 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [wanted, style]);

  const hide = () => { setWanted(false); clear(); };

  const openCube = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    try {
      const parsed = parseScientificFile(picked.name, await picked.text());
      if (!parsed.grid) throw new Error("This file has no Cube grid.");
      const fields = (parsed.gridDatasets ?? [{ label: fileStem(picked.name), grid: parsed.grid }])
        .filter((dataset) => sameGrid(field.grid, dataset.grid))
        .map((dataset, i) => ({ key: `file:${picked.name}:${i}`, label: parsed.gridDatasets ? `${fileStem(picked.name)} · ${dataset.label}` : dataset.label, grid: dataset.grid }));
      if (!fields.length) throw new Error("This Cube needs the same grid as the open one.");
      setOpened((previous) => [...previous.filter((item) => !item.key.startsWith(`file:${picked.name}:`)), ...fields]);
      setSecond(fields[0].key);
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  const a = all.find((item) => item.key === first) ?? own[0];
  const b = operation === "scale" ? null : all.find((item) => item.key === second) ?? all.find((item) => item.key !== a.key) ?? null;
  const create = async () => {
    try {
      const grid = combineGrids(operation, a.grid, b?.grid ?? null, factor);
      const name = `${operation === "scale" ? `${a.label}-${NAMES.scale}-${factor}` : `${a.label}-${NAMES[operation]}-${b!.label}`}.cube`;
      // The new field opens as a Cube file does: its atoms in the scene and the grid beside them,
      // with the Cube itself kept for download.
      const text = gridToCube(grid, science.atoms);
      await openScientificDocument(actions, name, parseScientificFile(name, text), "final", { name, file: new File([text], name) });
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  return (
    <div className="dock-content workbench-panel fields-panel">
      <div className="workbench-controls">
        <div className="workbench-row">
          {own.length > 1 ? (
            <label className="workbench-field">
              <span>Field</span>
              <NativeSelect size="sm" aria-label="Field" value={field.key} onChange={(event) => setChosen(event.target.value)}>
                {own.map((item) => <NativeSelectOption key={item.key} value={item.key}>{item.label}</NativeSelectOption>)}
              </NativeSelect>
            </label>
          ) : null}
          <div className="workbench-field">
            <span>Integral</span>
            <output className="fields-value" aria-label="Integral">{integral.toPrecision(4)}</output>
          </div>
        </div>
        <div className="workbench-row">
          <div className="workbench-field">
            <span>Plane</span>
            <SegmentedControl aria-label="Plane" value={String(axis)} onValueChange={(value) => choosePlane(Number(value) as SliceAxis)}>
              {PLANES.map(([value, label]) => <SegmentedControlItem key={value} value={String(value)}>{label}</SegmentedControlItem>)}
            </SegmentedControl>
          </div>
          <label className="workbench-field">
            <span>Contours</span>
            <ScrubNumberField aria-label="Contours" value={contours} min={0} max={30} step={1} formatValue={(value) => String(Math.round(value))}
              onValueChange={(value) => setContours(Math.round(value))} onValueCommitted={(value) => setContours(Math.round(value))} />
          </label>
          <div className="workbench-actions">
            {wanted ? <Button type="button" variant="secondary" size="xs" onClick={hide}>Hide slice</Button>
              : <Button type="button" size="xs" onClick={() => setWanted(true)}>Show slice</Button>}
          </div>
        </div>
        <div className="workbench-field">
          <span>Position, Å</span>
          <div className="fields-position">
            <Slider tone="neutral" aria-label="Slice position" min={0} max={field.grid.dimensions[axis] - 1} step={1} value={[position]} onValueChange={([value]) => setIndex(value)} />
            <output className="fields-value">{offset.toFixed(2)}</output>
          </div>
        </div>
        <FieldSlicePlot slice={slice} atoms={science.atoms} min={range.min} max={range.max} contours={contours} label={field.label} />
        <div className="workbench-field">
          <span>Colour range</span>
          <div className="potential-range">
            <ScrubNumberField aria-label="Lowest value" value={range.min} min={-1e6} max={1e6} step={limit / 50} formatValue={format}
              onValueChange={(value) => setLimit("min", value)} onValueCommitted={(value) => setLimit("min", value)} />
            <span className="potential-legend" aria-hidden />
            <ScrubNumberField aria-label="Highest value" value={range.max} min={-1e6} max={1e6} step={limit / 50} formatValue={format}
              onValueChange={(value) => setLimit("max", value)} onValueCommitted={(value) => setLimit("max", value)} />
          </div>
        </div>
        <div className="workbench-row fields-new">
          <label className="workbench-field">
            <span>New field</span>
            <NativeSelect size="sm" aria-label="Operation" value={operation} onChange={(event) => setOperation(event.target.value as FieldOperation)}>
              {OPERATIONS.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label className="workbench-field">
            <span>A</span>
            <NativeSelect size="sm" aria-label="Field A" value={a.key} onChange={(event) => setFirst(event.target.value)}>
              {all.map((item) => <NativeSelectOption key={item.key} value={item.key}>{item.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          {operation === "scale" ? (
            <label className="workbench-field">
              <span>k</span>
              <ScrubNumberField aria-label="Factor" value={factor} min={-1000} max={1000} step={0.1} formatValue={(value) => String(Number(value.toPrecision(4)))}
                onValueChange={setFactor} onValueCommitted={setFactor} />
            </label>
          ) : (
            <label className="workbench-field">
              <span>B</span>
              <NativeSelect size="sm" aria-label="Field B" value={b?.key ?? ""} onChange={(event) => setSecond(event.target.value)}>
                {b ? null : <NativeSelectOption value="" disabled>Open a Cube</NativeSelectOption>}
                {all.filter((item) => item.key !== a.key).map((item) => <NativeSelectOption key={item.key} value={item.key}>{item.label}</NativeSelectOption>)}
              </NativeSelect>
            </label>
          )}
          <input ref={fileInput} type="file" accept=".cube,.cub" hidden onChange={(event) => void openCube(event)} />
          <div className="workbench-actions">
            <Button type="button" variant="ghost" size="xs" onClick={() => fileInput.current?.click()}>Open Cube</Button>
            <Button type="button" size="xs" disabled={operation !== "scale" && !b} onClick={() => void create()}>Create</Button>
          </div>
        </div>
        {error ? <p role="alert" className="workbench-error">{error}</p> : null}
      </div>
    </div>
  );
}
