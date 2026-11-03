import { useEffect, useMemo, useState } from "react";
import { measureGeometry } from "../../../../../scripts/molecular-geometry.js";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { requestIndexedTrajectoryFrame } from "../../lib/indexed-trajectory-frame";
import { indexedFrameCsv, useIndexedTrajectorySource } from "../../lib/workbench/indexed-trajectory-source";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { Spinner } from "../ui/spinner";
import { SeriesChart, type PlotAxis } from "./plots-panel";
import { useCancellableJob } from "./use-workbench-source";

const MAX_SAMPLES = 256;
type Sample = { total: number; owner: string; sourceId: string; frameIndex: number; time?: number; maxForce?: number; rmsForce?: number; rmsSpeed?: number; geometry?: number; selection: string };
const MEASUREMENTS = { 2: ["distance", "Distance", "Å"], 3: ["angle", "Angle", "°"], 4: ["dihedral", "Dihedral", "°"] } as const;

function selection(text: string, count: number | null) {
  if (count === null || !text.trim()) return { atoms: [], error: null };
  const atoms = text.trim().split(/[\s,]+/u).map(Number);
  const valid = atoms.length in MEASUREMENTS && new Set(atoms).size === atoms.length && atoms.every(index => Number.isInteger(index) && index > 0 && index <= count);
  return { atoms: valid ? atoms.map(index => index - 1) : [], error: valid ? null : `Enter 2–4 distinct atom numbers from 1 to ${count}.` };
}

/** Samples only displayed frames. No hidden trajectory scan or inference of temperature. */
export function IndexedPlotsPanel({ document, actions }: { document: ViewerDocument; actions: ShellActions }) {
  const { frameIndex, segmentStartFrame, frame, error, loading } = useIndexedTrajectorySource(document, true);
  const owner = `${document.id}:${document.runtimePath}:${document.openClaimId ?? ""}:${document.path}`;
  const [samples, setSamples] = useState<Sample[]>([]);
  const [atomText, setAtomText] = useState("");
  const [measurementError, setMeasurementError] = useState<string | null>(null);
  const [exported, setExported] = useState(0);
  const job = useCancellableJob(`${owner}:${segmentStartFrame}:${frameIndex}`);
  const previousSample = samples.at(-1);
  const atomCount = frame?.total ?? (previousSample?.owner === owner ? previousSample.total : null);
  const selected = selection(atomText, atomCount);
  const measurement = selected.atoms.length ? MEASUREMENTS[selected.atoms.length as 2 | 3 | 4] : null;
  useEffect(() => {
    if (!frame) return;
    const controller = new AbortController();
    const sample: Sample = { total: frame.total, owner, sourceId: frame.sourceId, frameIndex: frame.frameIndex,
      ...(frame.time.unit === "ps" ? { time: frame.time.value } : {}), ...frame.summary, selection: atomText };
    const remember = () => setSamples(previous => {
      const current = previous.filter(item => item.owner === owner && item.sourceId === frame.sourceId && item.frameIndex !== frame.frameIndex);
      // Keep a bounded history of visited frames, not an eager frameCount-sized array.
      return [...current, sample].slice(-MAX_SAMPLES);
    });
    setMeasurementError(null);
    remember();
    if (!measurement) return () => controller.abort();
    const expected = { sourceId: frame.sourceId, modelId: frame.modelId, structureRef: frame.structureRef, frameIndex: frame.frameIndex, segmentIndex: frame.segmentIndex };
    void Promise.all(selected.atoms.map(async index => {
      const page = await requestIndexedTrajectoryFrame(document.id, { offset: index, limit: 1, expected }, controller.signal);
      if (!page.available || page.atoms[0]?.index !== index) throw new Error("The trajectory changed. Select the frame again.");
      return { id: String(index), position: page.atoms[0].position };
    })).then(atoms => {
      if (controller.signal.aborted) return;
      sample.geometry = measureGeometry(measurement[0], atoms).value as number;
      remember();
    }).catch(() => { if (!controller.signal.aborted) setMeasurementError("Could not measure this frame. Pause playback and select the frame again."); });
    return () => controller.abort();
  }, [frame, atomText, owner]);
  const visibleSourceId = frame?.sourceId ?? (samples.at(-1)?.owner === owner ? samples.at(-1)?.sourceId : null);
  const currentSamples = useMemo(() => samples.filter(item => item.owner === owner && item.sourceId === visibleSourceId).sort((a, b) => a.frameIndex - b.frameIndex), [samples, visibleSourceId, owner]);
  const axis: PlotAxis = useMemo(() => ({ kind: "frame", values: currentSamples.map(item => item.frameIndex + 1), frames: currentSamples.map(item => item.frameIndex), frameCount: frame?.frameCount }), [currentSamples, frame?.frameCount]);
  const cursor = frame ? currentSamples.findIndex(item => item.frameIndex === frame.frameIndex) : -1;
  const seek = (index: number) => {
    if (!frame || index === frame.frameIndex) return;
    const localIndex = Math.max(0, Math.min(frame.frameCount - 1, index));
    void actions.runStructureViewerAction(document, { type: "set_structure_pose", label: `Frame ${localIndex + 1}`, index: segmentStartFrame + localIndex });
  };
  const exportFrame = async () => {
    if (!frame) return;
    setExported(0);
    const csv = await job.run("Exporting frame…", signal => indexedFrameCsv(document.id, frame, signal, setExported));
    if (csv !== null) await actions.saveKetcherExportFile({ title: `${document.title.replace(/\.[^.]+$/u, "")}-frame-${frame.frameIndex + 1}.csv`, extension: "csv", text: csv });
  };
  const series = { axis, cursor: cursor < 0 ? null : cursor, onSeek: seek };
  const metrics = [
    { key: "rmsSpeed", name: "RMS speed", unit: "Å/ps" },
    { key: "maxForce", name: "Max force", unit: "kcal/(mol·Å)" },
    { key: "rmsForce", name: "RMS force", unit: "kcal/(mol·Å)" },
  ] as const;
  return <div className="dock-content workbench-panel workbench-plots">
    <div className="workbench-row">
      <span className="workbench-value workbench-source">{document.title}</span>
      {frame ? <>
        <ScrubNumberField name="trajectory-frame" autoComplete="off" aria-label="Trajectory frame" value={frame.frameIndex + 1} min={1} max={frame.frameCount} step={1} onValueChange={value => seek(Math.round(value) - 1)} />
        <span className="workbench-value">of {frame.frameCount}</span>
        {frame.time.unit === "ps" ? <span className="workbench-value">{frame.time.value.toFixed(3)} ps</span> : null}
        <span className="workbench-value">{currentSamples.length} sampled {currentSamples.length === 1 ? "frame" : "frames"}</span>
      </> : null}
      <span className="workbench-actions" aria-live="polite">
        {loading ? <Spinner className="size-3" aria-label="Reading frame…" /> : null}
        {job.running ? <><span role="status">{exported}/{frame?.total} atoms</span><Button size="xs" variant="ghost" onClick={job.cancel}>Cancel</Button></>
          : <Button size="xs" variant="ghost" disabled={!frame} onClick={() => void exportFrame()}>Export frame</Button>}
      </span>
    </div>
    {error || job.error ? <p role="alert" className="workbench-error">{error || job.error}</p> : null}
    <div className="workbench-charts">
      {metrics.map(metric => currentSamples.some(item => item[metric.key] !== undefined) ? <SeriesChart key={metric.key} {...series} name={metric.name} unit={metric.unit} digits={3}
        values={currentSamples.map(item => item[metric.key] ?? null)} header={value => <h3 className="workbench-chart-title">{metric.name}, {metric.unit}{value}</h3>} /> : null)}
      <SeriesChart {...series} name={measurement?.[1] ?? "Geometry"} unit={measurement?.[2] ?? ""} digits={3}
        values={measurement ? currentSamples.map(item => item.selection === atomText ? item.geometry ?? null : null) : null}
        header={value => <label className="workbench-field workbench-field-inline"><span>{measurement?.[1] ?? "Atoms"}{value}</span>
          <Input variant="compact" name="measurement-atoms" inputMode="numeric" aria-label="Atom numbers to measure" aria-invalid={Boolean(selected.error)} value={atomText} placeholder="1 2" spellCheck={false} autoComplete="off" onChange={event => setAtomText(event.currentTarget.value)} /></label>}
        footer={selected.error || measurementError ? <p role="alert" className="workbench-error">{selected.error || measurementError}</p> : null} />
    </div>
  </div>;
}
