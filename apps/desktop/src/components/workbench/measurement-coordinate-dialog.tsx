import { useEffect, useRef, useState, type FormEvent } from "react";
import { measureGeometry } from "../../../../../scripts/molecular-geometry.js";
import { editMeasurementCoordinate } from "../../lib/molecular-workbench/measurement-coordinate";
import { checkMeasurementSource, type MeasurementDialogRequest } from "../../lib/workbench/measurement-request";
import { closeWorkbenchDialog, isWorkbenchDialogRequestCurrent, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import { activeViewerIframeForDocument, isReadOnlyViewerMessageSource, requestViewerAction } from "../../lib/viewer-bridge";
import { checkBindingReport } from "../../lib/science-session/scene-binding";
import { positionsMatch } from "../../lib/source-editing/source-identity";
import { sourceExtension } from "../../lib/science-session/state";
import { useSourceEditing } from "../../lib/source-editing/context";
import { useGraphDraft, type GraphSnapshot } from "../../lib/workbench/use-graph-draft";
import type { ViewerDocument } from "../../types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { ScrubNumberField } from "../ui/scrub-number-input";
import { label } from "./structure-edit/values";
import "./workbench-layout.css";

const TITLES = { distance: "Distance", angle: "Angle", dihedral: "Dihedral" };
type Side = "smaller" | "first" | "last";

/** Opened from a 3D measurement; owns one request until it is applied, dismissed or replaced. */
export function MeasurementCoordinateDialogHost() {
  const request = useWorkbenchDialogRequest();
  const measurement = request?.kind === "measurement" && request.document && request.measurement ? request : null;
  const close = () => { if (measurement && isWorkbenchDialogRequestCurrent(measurement)) closeWorkbenchDialog(); };
  return <Dialog open={Boolean(measurement)} onOpenChange={open => { if (!open) close(); }}>
    {measurement ? <DialogContent variant="form" size="compact" className="flex flex-col gap-4" aria-describedby={undefined}>
      {/* The request object is the lifetime: a same-measurement reopen starts fresh. */}
      <MeasurementCoordinateDialogBody key={measurement.measurement!.requestId} document={measurement.document!}
        request={measurement.measurement!} isCurrent={() => isWorkbenchDialogRequestCurrent(measurement)} onDone={close} />
    </DialogContent> : null}
  </Dialog>;
}

export function MeasurementCoordinateDialogBody({ document, request, isCurrent: requestCurrent = () => true, onDone }: {
  document: ViewerDocument; request: MeasurementDialogRequest; isCurrent?: () => boolean; onDone: () => void;
}) {
  const editing = useSourceEditing();
  const graph = useGraphDraft(document, undefined, editing ? document => editing.beginEditing(document, "structure-edit") : undefined);
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [target, setTarget] = useState(0), [side, setSide] = useState<Side>("smaller");
  const [error, setError] = useState<string | null>(null), [checking, setChecking] = useState(false), [attempted, setAttempted] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  // The first loaded graph is the one the measurement was picked in; later revisions need a new pick.
  useEffect(() => {
    if (snapshot || !graph.history) return;
    try {
      const current = graph.history.current, atoms = current.structure.atoms;
      const value = measureGeometry(request.kind, request.atoms.map(index => ({ id: String(index), position: [atoms[index].x, atoms[index].y, atoms[index].z] }))).value as number;
      // An unchanged target checks the fragment cut before the user types anything.
      editMeasurementCoordinate(current.structure, { kind: request.kind, atoms: request.atoms, target: value });
      setSnapshot(current); setTarget(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Choose another measurement."); }
  }, [graph.history, snapshot, request]);

  const apply = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!snapshot || !editing || checking || graph.busy) return;
    const lifetime = editing.captureOperation(document), controller = new AbortController();
    pending.current = controller;
    const isCurrent = () => lifetime.isCurrent() && requestCurrent() && !controller.signal.aborted && !isReadOnlyViewerMessageSource(request.frameSource)
      && (sourceExtension(document) === "sd" ? "sdf" : sourceExtension(document)) === request.sourceFormat
      && activeViewerIframeForDocument(document.id, "molstar")?.contentWindow === request.frameSource;
    setChecking(true); setError(null); setAttempted(true);
    try {
      if (!isCurrent()) throw new Error("Open the measurement in the current structure again.");
      const session = editing.sessionForDocument(document);
      if (session && (session.content !== snapshot.text || session.previewState !== "current")) throw new Error("Wait for the structure to update, then open the measurement again.");
      // Displayed source, draft text and the graph's own atom order must all be the picked revision.
      const validateSource = async () => {
        const binding = await requestViewerAction(document.id, { type: "measurement_preview_capture" }, 60_000, controller.signal);
        await checkMeasurementSource(request, snapshot.text, binding);
        if (!positionsMatch(snapshot.structure.atoms.flatMap(atom => [atom.x, atom.y, atom.z]), checkBindingReport(binding).positions)) throw new Error("The structure changed. Open the measurement again.");
      };
      await validateSource();
      if (!isCurrent() || (editing.sessionForDocument(document)?.content ?? snapshot.text) !== snapshot.text) throw new Error("The structure changed. Open the measurement again.");
      const result = editMeasurementCoordinate(snapshot.structure, { kind: request.kind, atoms: request.atoms, target, side: side === "smaller" ? undefined : side });
      if (!result.movedAtoms.length || await graph.apply({ kind: "positions", from: snapshot, coordinates: result.coordinates }, { signal: controller.signal, isCurrent, validateBeforeWrite: validateSource })) onDone();
    } catch (cause) {
      if (requestCurrent() && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The measurement could not be changed.");
    } finally {
      lifetime.release();
      if (pending.current === controller) pending.current = null;
      setChecking(false);
    }
  };

  const structure = snapshot?.structure;
  let smaller: "first" | "last" | null = null;
  if (structure) {
    try { smaller = editMeasurementCoordinate(structure, { kind: request.kind, atoms: request.atoms, target }).side; } catch { /* Apply reports an invalid target. */ }
  }
  const ends = structure ? [label(structure, request.atoms[0]), label(structure, request.atoms.at(-1)!)] : [];
  const busy = checking || graph.busy, unit = request.kind === "distance" ? "Å" : "°", title = TITLES[request.kind];
  const message = error ?? (attempted || !graph.history ? graph.error : null);
  return <form className="flex flex-col gap-4" onSubmit={event => void apply(event)}>
    <DialogHeader><DialogTitle>{title}{structure ? ` ${request.atoms.map(atom => label(structure, atom)).join("–")}` : ""}</DialogTitle></DialogHeader>
    <label className="workbench-field"><span>{title}, {unit}</span>
      <ScrubNumberField autoFocus aria-label={`${title}, ${unit}`} value={target} disabled={!snapshot || busy}
        min={request.kind === "distance" ? 1e-6 : request.kind === "angle" ? 1e-6 : -180}
        max={request.kind === "distance" ? 1e6 : request.kind === "angle" ? 180 - 1e-6 : 180}
        step={request.kind === "distance" ? 0.01 : 1} smallStep={request.kind === "distance" ? 0.001 : 0.1}
        formatValue={value => request.kind === "distance" ? value.toFixed(4) : value.toFixed(2)} onValueChange={setTarget} onValueCommitted={setTarget} />
    </label>
    <label className="workbench-field"><span>Move</span>
      <NativeSelect aria-label="Move" size="sm" value={side} disabled={!snapshot || busy} onChange={event => setSide(event.target.value as Side)}>
        <NativeSelectOption value="smaller">{smaller && ends.length ? `Smaller side (${ends[smaller === "first" ? 0 : 1]})` : "Smaller side"}</NativeSelectOption>
        {ends.length ? <><NativeSelectOption value="first">{ends[0]} side</NativeSelectOption><NativeSelectOption value="last">{ends[1]} side</NativeSelectOption></> : null}
      </NativeSelect>
    </label>
    {message ? <p role="alert" className="workbench-error">{message}</p> : null}
    <DialogFooter>
      <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      <Button type="submit" disabled={!snapshot || busy}>{busy ? "Applying…" : "Apply"}</Button>
    </DialogFooter>
  </form>;
}
