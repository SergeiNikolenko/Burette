import { useRef, useState } from "react";
import { closeWorkbenchDialog, useWorkbenchDialogRequest } from "../../lib/workbench/dialog-store";
import { MOVIE_FRAME_RATES, recordSceneMovie, type MovieSettings } from "../../lib/workbench/scene-media";
import { isAbortError } from "../../lib/viewer-errors";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { ShortcutTooltip } from "../shortcut-tooltip";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";

/** Avogadro's Record Movie: the 3D view spinning once, or as shown while a vibration or trajectory plays. */
export function MovieDialogHost({ actions }: { actions: ShellActions }) {
  const request = useWorkbenchDialogRequest();
  const document = request?.kind === "movie" ? request.document : null;
  const recording = useRef<AbortController | null>(null);
  return (
    <Dialog open={Boolean(document)} onOpenChange={(open) => { if (!open && document) { recording.current?.abort(); closeWorkbenchDialog(); } }}>
      {document ? <DialogContent aria-describedby={undefined} variant="form" size="narrow">
        <DialogHeader><DialogTitle>Record movie</DialogTitle></DialogHeader>
        <MovieForm key={document.id} document={document} actions={actions} recording={recording} />
      </DialogContent> : null}
    </Dialog>
  );
}

function MovieForm({ document, actions, recording }: { document: ViewerDocument; actions: ShellActions; recording: { current: AbortController | null } }) {
  const [settings, setSettings] = useState<MovieSettings>({ seconds: 5, fps: 30, spin: true });
  const [length, setLength] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const record = async () => {
    const seconds = Number(length);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) { setError("Choose a length from 1 to 60 seconds."); return; }
    const controller = new AbortController();
    recording.current = controller;
    setBusy(true); setError(null);
    try {
      if (await recordSceneMovie(actions, document, { ...settings, seconds }, controller.signal)) closeWorkbenchDialog();
    } catch (caught) {
      if (!isAbortError(caught)) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (recording.current === controller) recording.current = null;
      setBusy(false);
    }
  };
  return (
    <form className="workbench-form" onSubmit={(event) => { event.preventDefault(); void record(); }}>
      <div className="workbench-field"><span>Motion</span>
        <SegmentedControl aria-label="Motion" value={settings.spin ? "spin" : "shown"} disabled={busy}
          onValueChange={(value) => { if (value) setSettings({ ...settings, spin: value === "spin" }); }}>
          <SegmentedControlItem value="spin">Spin</SegmentedControlItem>
          <ShortcutTooltip label="Records a vibration or trajectory as it plays">
            <SegmentedControlItem value="shown">As shown</SegmentedControlItem>
          </ShortcutTooltip>
        </SegmentedControl>
      </div>
      <label className="workbench-field"><span>Length, s</span>
        <Input variant="compact" type="number" min={1} max={60} step={1} value={length} disabled={busy} aria-label="Length in seconds"
          onChange={(event) => { setLength(event.target.value); setError(null); }} />
      </label>
      <div className="workbench-field"><span>Frame rate</span>
        <SegmentedControl aria-label="Frame rate" value={String(settings.fps)} disabled={busy}
          onValueChange={(value) => { if (value) setSettings({ ...settings, fps: Number(value) as MovieSettings["fps"] }); }}>
          {MOVIE_FRAME_RATES.map((fps) => <SegmentedControlItem key={fps} value={String(fps)}>{fps} fps</SegmentedControlItem>)}
        </SegmentedControl>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => { recording.current?.abort(); closeWorkbenchDialog(); }}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? <><Spinner aria-hidden className="size-3" />Recording…</> : "Record"}</Button>
      </DialogFooter>
    </form>
  );
}
