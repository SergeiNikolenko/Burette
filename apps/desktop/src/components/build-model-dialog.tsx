import { useEffect, useMemo, useRef, useState } from "react";

import { requestGridColumns } from "../hooks/use-app-derived-columns";
import { loadDerivedEngines } from "../lib/derived-columns";
import {
  MODEL_LIMITS,
  MODEL_METHODS,
  ModelProblem,
  modelSettingProblem,
  propertyModelProblem,
  type ModelMethod,
  type ModelTask,
  type PropertyModelRequest,
  type PropertyModelResult,
} from "../lib/property-models/build";
import { addPredictionColumn, fillEmptyCells, readModelTable } from "../lib/property-models/grid-table";
import { prepareModelInput, type ModelDescriptors, type ModelInput } from "../lib/property-models/model-input";
import { runPropertyModel } from "../lib/property-models/model-task";
import { nearestRows, neighbourSpace, type NeighbourSpace } from "../lib/property-models/neighbours";
import { closeWorkbenchDialog, useWorkbenchDialogRequest } from "../lib/workbench/dialog-store";
import type { ViewerDocument } from "../types";
import { Structure } from "./rgroup-preview";
import type { GridColumnChoice, StatusKind } from "./types";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Progress } from "./ui/progress";
import "./rgroup-analysis.css";
import "./build-model-dialog.css";

const MODEL_SEED = 1;
const NEIGHBOUR_COUNT = 5;
const PREDICTION_ROWS_SHOWN = 200;
const DESCRIPTOR_LABELS: Record<ModelDescriptors, string> = {
  properties: "Structure properties",
  fingerprint: "Structure fingerprint",
  columns: "Numeric columns",
};

type PushStatus = (message: string, kind?: StatusKind) => void;
type Progressing = { label: string; done?: number; total?: number; fraction?: number };
type BuiltModel = {
  target: GridColumnChoice;
  task: ModelTask;
  input: ModelInput;
  result: PropertyModelResult;
  /** Positions in `input.rows` of the rows the model was trained on. */
  knownRows: Int32Array;
  space: NeighbourSpace;
  /** Rows the model neither learned from nor predicts. */
  leftOut: number;
};

const formatNumber = (value: number) => String(Math.round(value * 1000) / 1000);

/** Build model, from the Analyze menu or the command palette of a collection. */
export function BuildModelDialogHost({ onStatus }: { onStatus: PushStatus }) {
  const request = useWorkbenchDialogRequest();
  const document = request?.kind === "model" ? request.document : null;
  return (
    <Dialog open={Boolean(document)} onOpenChange={(open) => { if (!open && document) closeWorkbenchDialog(); }}>
      {document ? <DialogContent aria-describedby={undefined} variant="form" size="xwide" className="min-w-0 overscroll-contain">
        <DialogHeader><DialogTitle>Build model</DialogTitle></DialogHeader>
        <BuildModelForm key={document.id} document={document} onStatus={onStatus} />
      </DialogContent> : null}
    </Dialog>
  );
}

function BuildModelForm({ document, onStatus }: { document: ViewerDocument; onStatus: PushStatus }) {
  const [columns, setColumns] = useState<GridColumnChoice[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [descriptors, setDescriptors] = useState<ModelDescriptors>("properties");
  const [chosenColumns, setChosenColumns] = useState<ReadonlySet<string>>(new Set());
  const [method, setMethod] = useState<ModelMethod>("forest");
  const [setting, setSetting] = useState(String(MODEL_METHODS.forest.initial));
  const [progress, setProgress] = useState<Progressing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [built, setBuilt] = useState<BuiltModel | null>(null);
  const [inspected, setInspected] = useState(0);
  const [applied, setApplied] = useState({ column: false, fill: false });
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    let current = true;
    requestGridColumns(document.id).then((found) => {
      if (!current) return;
      setColumns(found);
      setTargetId((found.find((column) => column.kind === "property" && column.type === "number") ?? found[0])?.id ?? "");
    }).catch(() => { if (current) setProblem("This collection could not be read."); });
    return () => { current = false; running.current?.abort(); };
  }, [document.id]);

  const target = columns?.find((column) => column.id === targetId) ?? null;
  const numericColumns = (columns ?? []).filter((column) => column.type === "number" && column.id !== targetId);
  const descriptorColumns = numericColumns.filter((column) => chosenColumns.has(column.id));
  const settingProblem = modelSettingProblem(method, Number(setting.trim() || Number.NaN));
  const ready = Boolean(target) && !settingProblem && (descriptors !== "columns" || descriptorColumns.length > 0);
  // A result describes the choices it was built from, so changing one withdraws it.
  const choose = (change: () => void) => { change(); setBuilt(null); setProblem(null); };

  const build = async () => {
    if (!target || !ready) return;
    const controller = new AbortController();
    running.current = controller;
    setBuilt(null);
    setProblem(null);
    setApplied({ column: false, fill: false });
    setProgress({ label: "Reading the collection" });
    try {
      const task: ModelTask = target.type === "number" ? "regression" : "classification";
      const table = await readModelTable(document.id, task, target.id, descriptorColumns.map((column) => column.id), descriptors !== "columns");
      if (controller.signal.aborted) return;
      if (table.truncated) throw new ModelProblem(`Build model works on up to ${MODEL_LIMITS.rows.toLocaleString()} rows.`);
      const engines = descriptors === "columns" ? null : await loadDerivedEngines();
      const input = await prepareModelInput(table.rows, task, descriptors, engines, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ label: "Calculating descriptors", done, total }),
      });
      const request: PropertyModelRequest = {
        features: input.features,
        rowCount: input.rows.length,
        featureCount: input.featureCount,
        target: input.target,
        task,
        classCount: input.classes.length,
        method,
        setting: Number(setting),
        metric: input.metric,
        seed: MODEL_SEED,
      };
      const requestProblem = propertyModelProblem(request);
      if (requestProblem) throw new ModelProblem(requestProblem);
      setProgress({ label: "Training", fraction: 0 });
      const result = await runPropertyModel(request, {
        signal: controller.signal,
        onProgress: (fraction) => setProgress({ label: "Training", fraction }),
      });
      const knownRows = Int32Array.from(input.rows.flatMap((_, row) => Number.isNaN(input.target[row]) ? [] : [row]));
      setBuilt({
        target, task, input, result, knownRows,
        space: neighbourSpace(input.features, input.rows.length, input.featureCount, input.metric, knownRows),
        leftOut: input.skippedRows + table.unreadableRows,
      });
      setInspected(input.target.findIndex((value) => Number.isNaN(value)));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof ModelProblem)) console.error("[Build model]", error);
      setProblem(error instanceof ModelProblem ? error.message : "The model could not be built.");
    } finally {
      if (running.current === controller) { running.current = null; setProgress(null); }
    }
  };

  return (
    <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void build(); }}>
      <div className="build-model-fields">
        <label><span>Column</span>
          <NativeSelect name="target" className="w-full" value={targetId} disabled={!columns || Boolean(progress)}
            onChange={(event) => choose(() => setTargetId(event.target.value))}>
            {(columns ?? []).map((column) => <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label><span>Descriptors</span>
          <NativeSelect name="descriptors" className="w-full" value={descriptors} disabled={Boolean(progress)}
            onChange={(event) => choose(() => setDescriptors(event.target.value as ModelDescriptors))}>
            {(Object.keys(DESCRIPTOR_LABELS) as ModelDescriptors[]).map((kind) => <NativeSelectOption key={kind} value={kind}>{DESCRIPTOR_LABELS[kind]}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label><span>Method</span>
          <NativeSelect name="method" className="w-full" value={method} disabled={Boolean(progress)}
            onChange={(event) => choose(() => {
              const next = event.target.value as ModelMethod;
              setMethod(next);
              setSetting(String(MODEL_METHODS[next].initial));
            })}>
            {(Object.keys(MODEL_METHODS) as ModelMethod[]).map((kind) => <NativeSelectOption key={kind} value={kind}>{MODEL_METHODS[kind].label}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <label><span>{MODEL_METHODS[method].setting}</span>
          <Input variant="field" name="setting" inputMode="numeric" autoComplete="off" value={setting} disabled={Boolean(progress)}
            aria-invalid={Boolean(setting.trim() && settingProblem)} title={settingProblem ?? undefined}
            onChange={(event) => choose(() => setSetting(event.target.value))} />
        </label>
      </div>
      {descriptors === "columns" && <fieldset className="build-model-columns" aria-label="Descriptor columns" disabled={Boolean(progress)}>
        {numericColumns.map((column) => (
          <label key={column.id}>
            <Checkbox checked={chosenColumns.has(column.id)} onCheckedChange={() => choose(() => setChosenColumns((previous) => {
              const next = new Set(previous);
              if (!next.delete(column.id)) next.add(column.id);
              return next;
            }))} />
            <span>{column.label}</span>
          </label>
        ))}
      </fieldset>}
      {problem && <p className="text-sm text-(--color-text-danger)" role="alert">{problem}</p>}
      <div className="flex min-h-7 items-center gap-3">
        {progress && <div className="flex min-w-0 flex-1 items-center gap-3 text-xs tabular-nums" role="status">
          <span className="shrink-0">{progress.label}{progress.total ? ` ${progress.done!.toLocaleString()} / ${progress.total.toLocaleString()}` : ""}</span>
          <Progress aria-label={progress.label}
            value={progress.total ? 100 * progress.done! / progress.total : progress.fraction === undefined ? undefined : 100 * progress.fraction} />
        </div>}
        {progress
          ? <Button type="button" variant="secondary" className="ml-auto" onClick={() => { running.current?.abort(); running.current = null; setProgress(null); }}>Stop</Button>
          : <Button type="submit" variant={built ? "secondary" : "default"} className="ml-auto" disabled={!ready}>Build model</Button>}
      </div>
      {built && <ModelResult document={document} built={built} inspected={inspected} applied={applied}
        onInspect={setInspected} onApplied={setApplied} onProblem={setProblem} onStatus={onStatus} />}
    </form>
  );
}

function ModelResult({ document, built, inspected, applied, onInspect, onApplied, onProblem, onStatus }: {
  document: ViewerDocument;
  built: BuiltModel;
  inspected: number;
  applied: { column: boolean; fill: boolean };
  onInspect: (row: number) => void;
  onApplied: (applied: { column: boolean; fill: boolean }) => void;
  onProblem: (problem: string | null) => void;
  onStatus: PushStatus;
}) {
  const { target, task, input, result, knownRows, space, leftOut } = built;
  const display = (value: number) => task === "classification" ? input.classes[value] : formatNumber(value);
  const missing = useMemo(() => input.rows.flatMap((_, row) => Number.isNaN(input.target[row]) ? [row] : []), [input]);
  // Rows the model fills come first: they are the ones without a value to compare against.
  const listed = useMemo(() => [...missing, ...knownRows].slice(0, PREDICTION_ROWS_SHOWN), [missing, knownRows]);
  const row = inspected >= 0 ? inspected : listed[0];
  const neighbours = useMemo(() => nearestRows(space, row, knownRows, NEIGHBOUR_COUNT), [space, row, knownRows]);
  const canFill = target.id.startsWith("prop:") && missing.length > 0;

  const addColumn = async () => {
    const label = `Predicted ${target.label}`;
    try {
      await addPredictionColumn(document.id, label, new Map(input.rows.map((source, index) => {
        const value = result.predictions[index];
        return [source.index, task === "classification" ? input.classes[value] : value];
      })));
      onApplied({ ...applied, column: true });
      onStatus(`${label} added to ${document.title}`, "success");
    } catch (error) {
      console.error("[Build model]", error);
      onProblem("The column could not be added.");
    }
  };
  const fill = async () => {
    try {
      const filled = await fillEmptyCells(document.id, target, missing.map((index) => [input.rows[index].index, display(result.predictions[index])]));
      if (filled === null) { onProblem("This collection cannot be edited."); return; }
      onApplied({ ...applied, fill: true });
      onStatus(`Filled ${filled.toLocaleString()} missing value${filled === 1 ? "" : "s"} of ${target.label}`, "success");
    } catch (error) {
      console.error("[Build model]", error);
      onProblem("The values could not be filled.");
    }
  };

  return (
    <section className="build-model-result" aria-label="Model">
      <dl className="build-model-scores">
        <div><dt>{task === "classification" ? "Cross-validated accuracy" : "Cross-validated R²"}</dt>
          <dd>{task === "classification" ? `${(100 * result.score).toFixed(1)}%` : result.score.toFixed(3)}</dd></div>
        {result.error !== null && <div><dt>RMSE</dt><dd>{formatNumber(result.error)}</dd></div>}
        <div><dt>Training rows</dt><dd>{result.trainedRows.toLocaleString()}</dd></div>
        {leftOut > 0 && <div title="Rows without descriptors, or with text where the column holds numbers"><dt>Left out</dt><dd>{leftOut.toLocaleString()}</dd></div>}
      </dl>
      <div className="build-model-predictions">
        <table aria-label="Predictions">
          <thead><tr>
            <th scope="col">Name</th>
            <th scope="col">{target.label}</th>
            <th scope="col" title="A row with a value shows what a model trained without that row predicts">Predicted</th>
          </tr></thead>
          <tbody>
            {listed.map((index) => (
              <tr key={index} tabIndex={0} aria-selected={index === row} onClick={() => onInspect(index)}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onInspect(index); } }}>
                <th scope="row">{input.rows[index].name}</th>
                <td>{Number.isNaN(input.target[index]) ? "" : display(input.target[index])}</td>
                <td>{display(result.predictions[index])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="text-xs font-medium">Nearest training rows to {input.rows[row].name}</h3>
      <ol className="build-model-neighbours" aria-label="Nearest training rows">
        {Array.from(neighbours.rows, (neighbour, position) => {
          const source = input.rows[neighbour];
          const structure = source.molblock ?? source.smiles;
          const distance = neighbours.distances[position];
          return (
            <li key={neighbour}>
              {structure && <Structure smiles={structure} label={source.name} />}
              <span className="truncate" title={source.name}>{source.name}</span>
              <span>{target.label} {display(input.target[neighbour])}</span>
              <span>{space.metric === "tanimoto" ? `Similarity ${(1 - distance).toFixed(2)}` : `Distance ${distance.toFixed(2)}`}</span>
            </li>
          );
        })}
      </ol>
      <DialogFooter>
        {canFill && <Button type="button" variant="secondary" disabled={applied.fill} onClick={() => { void fill(); }}>
          Fill {missing.length.toLocaleString()} missing value{missing.length === 1 ? "" : "s"}
        </Button>}
        <Button type="button" disabled={applied.column} onClick={() => { void addColumn(); }}>Add column</Button>
      </DialogFooter>
    </section>
  );
}
