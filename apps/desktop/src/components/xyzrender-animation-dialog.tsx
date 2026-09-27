import { renderXyzrender, saveXyzrenderFile, type SavedXyzrenderFile } from "../lib/xyzrender-transport";
import { createAnimationBudget } from "../lib/xyzrender-animation-budget";
import { useXyzrenderPlayback } from "../hooks/use-xyzrender-playback";
import { ScrubNumberField } from "./ui/scrub-number-input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { XyzrenderOrientationPanel } from "./xyzrender-orientation-panel";
import { Switch } from "./ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui/button";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";
import { ChevronDown, Download, X } from "./ui/app-icons";
import { Progress } from "./ui/progress";
import { safeExportFileName } from "../lib/file-export";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { decodeAnimation, encodeAnimation, type AnimationFrames } from "../lib/xyzrender-animation";
import { postToXyzrenderViewer } from "../lib/viewer-bridge";
import { gifBytesToBase64, renderAnimationGifDataUrl } from "../lib/xyzrender-batch-animation";

export type AnimationSource = {
  itemId?: string;
  documentId?: string;
  label: string;
  previewSvg: string;
  path: string;
  preset: string;
  controls: Record<string, unknown>;
  inputDataBase64?: string;
  inputExtension?: string;
  animationSourcePath?: string;
  animationSourceExtension?: string;
  orientationRef?: string;
  orientationBaseRef?: string;
  angles?: number[];
};
const frameOptions = [24, 48, 60, 120, 180, 240];
const sizeOptions = [256, 384, 480, 640, 800, 1024];
// Worker startup dominates small renders: 384 px x 120 frames costs about the
// same as 60 frames and a third of the former 640 px x 240 default.
const DEFAULT_SIZE = 384;
const DEFAULT_FRAMES = 120;
const DEFAULT_FPS = 30;
// A low-resolution draft only pays off when the final pass is expensive.
const DRAFT_THRESHOLD = 480;

type Mode = "rotation" | "bounce" | "trajectory" | "vibration" | "assembly";

type BatchProgress = { done: number; total: number; failed: string[]; skipped: number; finished: boolean };

// Miller directions need lattice data, not just molecular coordinates.
const isCrystalSource = (source: AnimationSource) => (source.inputExtension || source.path.split('.').pop() || '').toLowerCase().replace(/^\./, '') === 'cif';
const axisFor = (source: AnimationSource, axis: string) => !isCrystalSource(source) && /^-?\d{3}$/.test(axis) ? 'y' : axis;

type AnimationSettings = { mode: Mode; selectedAxis: string; amplitude: number; rotate: boolean; rebuildBonds: boolean; noise: number; anchor: string; forward: boolean; fps: number; size: number; frames: number };

export function XyzrenderAnimationDialog() {
  const [reserve] = useState(createAnimationBudget);
  const settings = useRef(new Map<string, AnimationSettings>());
  const remember = useCallback((key: string, value: AnimationSettings) => {
    settings.current.set(key, value);
    if (settings.current.size > 32) settings.current.delete(settings.current.keys().next().value!);
  }, []);
  const [source, setSource] = useState<AnimationSource | null>(null);
  const [selection, setSelection] = useState<{ documentId?: string; items: AnimationSource[] }>({ items: [] });
  const [animationSources, setAnimationSources] = useState<AnimationSource[]>([]);
  const retainedSources = useRef(animationSources);
  retainedSources.current = animationSources;
  const prepare = useCallback((next: AnimationSource) => {
    setAnimationSources(previous => {
      const current = previous.filter(item => item.documentId === next.documentId);
      const key = next.itemId || next.path;
      const existing = current.findIndex(item => (item.itemId || item.path) === key);
      if (existing < 0) return [...current, next];
      const item = current[existing];
      if (item.preset === next.preset && item.orientationRef === next.orientationRef && JSON.stringify(item.controls) === JSON.stringify(next.controls)) return previous;
      return current.map((item, index) => index === existing ? next : item);
    });
  }, []);
  useEffect(() => {
    if (source && (source.inputExtension || source.path.split('.').pop())?.toLowerCase() === 'cif') prepare(source);
  }, [source, prepare]);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const open = (event: Event) => { setSource((event as CustomEvent<AnimationSource>).detail); window.setTimeout(() => { const node = document.getElementById("xyzrender-editor-controls"); setTarget(node); node?.scrollIntoView({ block: "nearest" }); }, 50); };
    window.addEventListener("burette:xyzrender-animation", open);
    const style = (event: Event) => {
      const detail = (event as CustomEvent<AnimationSource>).detail;
      setSource(current => current && (detail.itemId ? current.itemId === detail.itemId : current.path === detail.path || (current.documentId && current.documentId === detail.documentId) || (!current.documentId && current.label === detail.label)) ? { ...current, preset: detail.preset, controls: detail.controls } : current);
    };
    const select = (event: Event) => {
      const next = (event as CustomEvent<AnimationSource>).detail;
      setSource(current => {
        if (!current || current.itemId === next.itemId) return current;
        return next;
      });
    };
    const remove = (event: Event) => {
      const { itemId } = (event as CustomEvent<{ itemId: string }>).detail;
      settings.current.delete(itemId);
      setAnimationSources(current => current.filter(item => item.itemId !== itemId));
      setSource(current => current?.itemId === itemId ? retainedSources.current.find(item => item.itemId !== itemId) || null : current);
    };
    const selected = (event: Event) => setSelection((event as CustomEvent<{ documentId?: string; items: AnimationSource[] }>).detail);
    window.addEventListener("burette:xyzrender-selection", selected);
    window.addEventListener("burette:xyzrender-item-removed", remove);
    window.addEventListener("burette:xyzrender-active-item", select);
    window.addEventListener("burette:xyzrender-style", style);
    return () => { window.removeEventListener("burette:xyzrender-selection", selected); window.removeEventListener("burette:xyzrender-item-removed", remove); window.removeEventListener("burette:xyzrender-active-item", select); window.removeEventListener("burette:xyzrender-animation", open); window.removeEventListener("burette:xyzrender-style", style); };
  }, []);
  return source && target ? createPortal(<section className="xyzrender-motion-controls flex flex-col gap-3 border-b border-border py-3">
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1"><XyzrenderOrientationPanel key={`${source.documentId || source.path}:${source.itemId || ""}`} source={source} onPrepared={prepare} /></div>
      <Button variant="ghost" size="icon-sm" aria-label="Close orientation and animation" onClick={() => setSource(null)}><X /></Button>
    </div>
    {animationSources.map(item => {
      const visible = (item.itemId || item.path) === (source.itemId || source.path);
      return <div key={item.itemId || item.path} hidden={!visible}>
        <AnimationContent reserve={reserve} source={item} visible={visible} suspended={false} initial={settings.current.get(item.itemId || item.path)} remember={remember}
          selection={visible && selection.documentId === item.documentId ? selection.items : []} />
      </div>;
    })}
  </section>, target) : null;
}

function AnimationContent({ source, reserve, suspended, visible, initial, remember, selection }: { source: AnimationSource; reserve: (key: string, pixels: number) => boolean; suspended: boolean; visible: boolean; initial?: AnimationSettings; remember: (key: string, settings: AnimationSettings) => void; selection: AnimationSource[] }) {
  // xyzrender refuses GIF output for the 2D skeletal drawing.
  const animatable = source.preset !== "skeletal";
  // Rendering is expensive, so it starts only on an explicit request.
  const [requested, setRequested] = useState(false);
  // The canvas shows the preview until a GIF is applied or another item is edited.
  const [live, setLive] = useState(false);
  const [pendingAction, setPendingAction] = useState<"apply" | "save" | null>(null);
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "rotation");
  const [selectedAxis, setAxis] = useState(initial?.selectedAxis ?? "y");
  const crystalInput = isCrystalSource(source);
  const axis = axisFor(source, selectedAxis);
  const [amplitude, setAmplitude] = useState(initial?.amplitude ?? 45);
  const [rotate, setRotate] = useState(initial?.rotate ?? false);
  const [rebuildBonds, setRebuildBonds] = useState(initial?.rebuildBonds ?? false);
  const [noise, setNoise] = useState(initial?.noise ?? 0.3);
  const [anchor, setAnchor] = useState(initial?.anchor ?? "");
  const [forward, setForward] = useState(initial?.forward ?? false);
  const [retry, setRetry] = useState(0);
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => () => exportController.current?.abort(), []);
  const [animation, setAnimation] = useState<AnimationFrames | null>(null);
  const [preview, setPreview] = useState(false);
  const [range, setRange] = useState([0, DEFAULT_FRAMES - 1]);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(initial?.fps ?? DEFAULT_FPS);
  const [size, setSize] = useState(initial?.size ?? DEFAULT_SIZE);
  const [frames, setFrames] = useState(initial?.frames ?? DEFAULT_FRAMES);
  useEffect(() => {
    remember(source.itemId || source.path, { mode, selectedAxis, amplitude, rotate, rebuildBonds, noise, anchor, forward, fps, size, frames });
  }, [source.itemId, source.path, remember, mode, selectedAxis, amplitude, rotate, rebuildBonds, noise, anchor, forward, fps, size, frames]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState<SavedXyzrenderFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState("");
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const batchController = useRef<AbortController | null>(null);
  useEffect(() => () => batchController.current?.abort(), []);
  const batchRunning = Boolean(batch && !batch.finished);
  const selectionKey = selection.map(item => item.itemId).join("\n");
  useEffect(() => { setBatch(current => current?.finished ? null : current); }, [selectionKey]);
  const animatableSelection = selection.filter(item => item.preset !== "skeletal");
  const [frame, setFrame] = useXyzrenderPlayback(animation, playing, fps, range, source.itemId, source.documentId, suspended || !live || !animatable, visible);
  useEffect(() => {
    if (!requested || !animatable) return;
    const reservationKey = source.itemId || source.path;
    if (!reserve(reservationKey, size * size * frames)) {
      setError("Animation memory is full. Reduce the image size or remove another animated structure.");
      setBusy(false);
      setPendingAction(null);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 125_000);
    let disposed = false;
    let retainedPixels = animation ? animation.width * animation.height * animation.frames.length : 0;
    setBusy(true); setError(""); setUnavailable(""); setSaved(null);
    const render = async () => {
      try {
        const { label: _label, previewSvg: _preview, ...input } = source;
        // Keep every motion frame from the first pass; refine only spatial resolution.
        // Trajectories retain their source frames, so do not render them twice.
        const passes = mode === "trajectory" || size <= DRAFT_THRESHOLD ? [size] : [256, size];
        let previewCount = animation?.frames.length || 0;
        for (const resolution of passes) {
          const draft = resolution !== size;
          const response = await renderXyzrender({ ...input, animation: { mode, axis, size: resolution, frames, fps: 10, amplitude, rotate, rebuildBonds, noise, anchor, forward } }, controller.signal);
          const payload = await response.json();
          if (!response.ok && (payload.code === 'animation_unavailable' || (mode === 'vibration' && /vibrat|frequen|normal.mode|imaginary/i.test(payload.error || '')))) {
            if (!disposed) {
              setUnavailable(mode === 'trajectory' ? 'This file contains one structure. A trajectory needs at least two coordinate frames.' : 'This file has no supported vibrational mode. Open a frequency calculation to animate vibrations.');
              setPendingAction(null);
            }
            return;
          }
          if (disposed) return;
          if (!response.ok || typeof payload.gifBase64 !== "string") {
            if (draft) continue; // A preview failure must not prevent the final render.
            throw new Error(payload.error || "The animation could not be rendered.");
          }
          const bytes = Uint8Array.from(atob(payload.gifBase64), char => char.charCodeAt(0));
          const decoded = decodeAnimation(bytes.buffer);
          if (!reserve(reservationKey, Math.max(size * size * frames, decoded.width * decoded.height * decoded.frames.length))) throw new Error("Animation memory limit reached");
          retainedPixels = decoded.width * decoded.height * decoded.frames.length;
          const previousCount = previewCount;
          setAnimation(decoded); setPreview(draft);
          setRange(current => previousCount ? current.map(value => Math.min(decoded.frames.length - 1, Math.round(value * decoded.frames.length / previousCount))) : [0, decoded.frames.length - 1]);
          setFrame(value => previousCount ? Math.min(decoded.frames.length - 1, Math.round(value * decoded.frames.length / previousCount)) : 0);
          // Preserve pause and playback position when the detailed pass arrives.
          if (!previousCount) { setLive(true); setPlaying(true); }
          if (draft) previewCount = decoded.frames.length;
        }
      } catch (cause) {
        if (!disposed) {
          setError(controller.signal.aborted ? "Rendering timed out. Try again." : cause instanceof Error ? cause.message : "Could not render this animation. Try another motion or reduce the export size.");
          setPendingAction(null);
        }
      } finally {
        window.clearTimeout(timeout);
        if (!disposed) { reserve(reservationKey, retainedPixels); setBusy(false); }
      }
    };
    const debounce = window.setTimeout(() => void render(), 350);
    return () => { window.clearTimeout(debounce); disposed = true; controller.abort(); window.clearTimeout(timeout); reserve(reservationKey, 0); };
  }, [requested, animatable, source, mode, axis, size, frames, amplitude, rotate, rebuildBonds, noise, anchor, forward, retry, reserve]);
  const position = (index: number) => mode === "rotation"
    ? `${Math.round(index * 360 / (animation?.frames.length || frames))}°`
    : `Frame ${index + 1}`;
  const startRender = () => {
    if (busy) return;
    if (requested) setRetry(value => value + 1);
    else setRequested(true);
  };
  const save = async (applyToCanvas = false) => {
    if (!animation || preview || busy) {
      if (!animatable || saving) return;
      setPendingAction(applyToCanvas ? "apply" : "save");
      startRender();
      return;
    }
    const controller = new AbortController(); exportController.current = controller;
    setSaving(true); setPlaying(false); setProgress(0); setError(""); setSaved(null);
    try {
      const gif = gifBytesToBase64(await encodeAnimation(animation, range[0], range[1], fps, setProgress, controller.signal));
      if (applyToCanvas) {
        postToXyzrenderViewer(source.documentId, { type: 'applyXyzrenderAnimation', itemId: source.itemId, image: 'data:image/gif;base64,' + gif, commit: true });
        setLive(false);
        return;
      }
      const result = await saveXyzrenderFile(safeExportFileName(`${source.label.replace(/\.[^.]+$/, "")}-${mode}.gif`), "gif", gif, controller.signal);
      setSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  // Apply or Save pressed before the first render finishes runs once frames arrive.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!pendingAction || busy || preview || !animation) return;
    setPendingAction(null);
    void saveRef.current(pendingAction === "apply");
  }, [pendingAction, busy, preview, animation]);
  const togglePlayback = () => {
    if (!animation) { startRender(); return; }
    setLive(true);
    setPlaying(value => !value);
  };
  // Selected structures render one after another with these motion settings;
  // each GIF goes straight to its own card.
  const applyToSelection = async () => {
    const controller = new AbortController(); batchController.current = controller;
    // The inspected item's live preview would repaint over its applied GIF.
    setLive(false); setPlaying(false); setError(""); setSaved(null);
    const progress: BatchProgress = { done: 0, total: animatableSelection.length, failed: [], skipped: selection.length - animatableSelection.length, finished: false };
    setBatch({ ...progress });
    for (const item of animatableSelection) {
      if (controller.signal.aborted) break;
      try {
        const { label: _label, previewSvg: _preview, ...input } = item;
        const image = await renderAnimationGifDataUrl({ ...input, animation: { mode, axis: axisFor(item, selectedAxis), size, frames, fps: 10, amplitude, rotate, rebuildBonds, noise, anchor, forward } }, fps, controller.signal);
        postToXyzrenderViewer(item.documentId, { type: 'applyXyzrenderAnimation', itemId: item.itemId, image, commit: true });
      } catch {
        if (controller.signal.aborted) break;
        progress.failed = [...progress.failed, item.label];
      }
      progress.done += 1;
      setBatch({ ...progress });
    }
    setBatch({ ...progress, finished: true });
  };
  const batchStatus = !batch ? `${selection.length} structures selected. Each one is rendered with these motion settings and gets its own GIF.`
    : !batch.finished ? `Animating ${Math.min(batch.done + 1, batch.total)} of ${batch.total}…`
    : [batch.done < batch.total ? `Stopped after ${batch.done} of ${batch.total}` : `Applied to ${batch.done - batch.failed.length} of ${batch.total}`,
      batch.failed.length ? `failed: ${batch.failed.join(", ")}` : "", batch.skipped ? `${batch.skipped} skeletal skipped` : ""].filter(Boolean).join(" · ");
  const batchControls = selection.length > 1 && <div className="flex flex-col gap-2 border-t border-border pt-3">
    <FieldDescription role="status">{batchStatus}</FieldDescription>
    {batchRunning && batch && <Progress aria-label="Animating selected structures" value={batch.done * 100 / Math.max(1, batch.total)} />}
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={busy || saving || batchRunning || !animatableSelection.length} onClick={() => void applyToSelection()}>Apply to {selection.length} selected</Button>
      {batchRunning && <Button variant="ghost" onClick={() => batchController.current?.abort()}>Cancel</Button>}
    </div>
  </div>;
  if (!animatable) return <div className="flex flex-col gap-2 py-2">
    <strong>Skeletal style can't be animated</strong>
    <p className="text-sm text-muted-foreground">Skeletal is a flat 2D drawing, so xyzrender can't rotate it into a GIF. Choose another style below to animate this structure.</p>
    {batchControls}
  </div>;
  if (unavailable) return <div className="flex flex-col gap-3 py-2">
    <strong>{mode === 'trajectory' ? 'No trajectory in this file' : 'No vibration data in this file'}</strong>
    <p className="text-sm text-muted-foreground">{unavailable}</p>
    <Button variant="outline" onClick={() => setMode('rotation')}>Use full rotation</Button>
  </div>;
  return <div className="flex flex-col gap-4">
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-4">
        <Field>
          <div className="flex items-center justify-between gap-2"><FieldLabel>View · {position(frame)}</FieldLabel>
            <Button size="sm" variant="outline" disabled={busy || saving || batchRunning} onClick={togglePlayback}>{!animation ? "Preview" : playing && live ? "Pause" : "Play"}</Button></div>
          <Slider tone="neutral" aria-label="Molecule rotation" min={0} max={Math.max(1, (animation?.frames.length || frames) - 1)} step={1} value={[frame]} disabled={!animation || saving}
            onValueChange={value => { setLive(true); setPlaying(false); setFrame(value[0]); }} />
        </Field>
      </div>
      <FieldGroup className="gap-3">
        <Field orientation="horizontal">
          <FieldLabel>Motion</FieldLabel>
          <Select value={mode} onValueChange={value => setMode(value as Mode)} disabled={saving}>
            <SelectTrigger aria-label="Motion" className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
              <SelectItem value="rotation">Full rotation</SelectItem><SelectItem value="bounce">Rock</SelectItem><SelectItem value="trajectory">Trajectory</SelectItem><SelectItem value="vibration">TS vibration</SelectItem><SelectItem value="assembly">Assembly</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
        </Field>
        {(mode !== "trajectory" || rotate) && <Field orientation="horizontal">
          <FieldLabel>Axis</FieldLabel>
          <Select value={axis} onValueChange={setAxis} disabled={saving}><SelectTrigger aria-label="Rotation axis" className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{['x','y','z','xy','xz','yz','-x','-y','-z','-xy', ...(crystalInput ? ['111','001'] : [])].map(value => <SelectItem key={value} value={value}>{value.toUpperCase()}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>}
        {(mode === 'bounce' || (mode === 'assembly' && rotate)) && <Field orientation="horizontal"><FieldLabel>Angle</FieldLabel>
          <ScrubNumberField aria-label="Rotation amplitude" formatValue={value => `${value}°`} min={1} max={180} step={1} smallStep={1} value={amplitude} onValueChange={setAmplitude} className="w-28" />
        </Field>}
        {['trajectory', 'vibration', 'assembly'].includes(mode) && <Field orientation="horizontal"><FieldLabel htmlFor="xyzr-rotate">Add rotation</FieldLabel><Switch id="xyzr-rotate" checked={rotate} onCheckedChange={setRotate} /></Field>}
        {mode === 'trajectory' && <Field orientation="horizontal"><FieldLabel htmlFor="xyzr-bonds">Update bonds each frame</FieldLabel><Switch id="xyzr-bonds" checked={rebuildBonds} onCheckedChange={setRebuildBonds} /></Field>}
        {mode === 'vibration' && <FieldDescription>Requires vibrational data from a frequency calculation.</FieldDescription>}
        {mode === 'assembly' && <>
          <FieldDescription>Decorative scatter / assembly, not a physical trajectory.</FieldDescription>
          <Field orientation="horizontal"><FieldLabel>Noise</FieldLabel><ScrubNumberField allowTextInput={false} aria-label="Assembly noise" min={0} max={2} step={0.1} smallStep={0.01} value={noise} onValueChange={setNoise} className="w-28" /></Field>
          <Field><FieldLabel htmlFor="xyzr-anchor">Fixed atoms</FieldLabel><Input id="xyzr-anchor" placeholder="1-5,8" defaultValue={anchor} onBlur={event => setAnchor(event.target.value)} /></Field>
          <Field orientation="horizontal"><FieldLabel htmlFor="xyzr-forward">Scatter outward</FieldLabel><Switch id="xyzr-forward" checked={forward} onCheckedChange={setForward} /></Field>
        </>}
        <Field orientation="horizontal"><FieldLabel htmlFor="xyzr-fps">Speed</FieldLabel>
          <ScrubNumberField pixelSensitivity={4} calligraph={{ variant: "number", animation: "none", stagger: 0, autoSize: false }} allowTextInput={false} id="xyzr-fps" aria-label="Frames per second" formatValue={value => `${value} fps`} min={30} max={120} step={1} smallStep={1} value={fps} disabled={saving} onValueChange={value => { setFps(value); setSaved(null); }} className="w-28" /></Field>
        <Collapsible><CollapsibleTrigger asChild><Button variant="outline" className="group w-full justify-between h-10"><span>GIF settings</span><span className="ml-auto text-muted-foreground">{size} px · {mode === "trajectory" ? animation ? `${animation.frames.length} frames` : "source frames" : `${frames} frames`}</span><ChevronDown className="transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pt-3">
        <Field><FieldLabel>Export range · {position(range[0])} – {position(range[1])}</FieldLabel>
          <Slider tone="neutral" aria-label="Export frame range" min={0} max={Math.max(1, (animation?.frames.length || frames) - 1)} step={1} minStepsBetweenThumbs={1} value={range} disabled={!animation || animation.frames.length < 2 || saving}
            onValueChange={value => { setRange(value); setFrame(value[0]); setPlaying(false); setSaved(null); }} />
          <FieldDescription>{range[1] - range[0] + 1} frames · {((range[1] - range[0] + 1) / fps).toFixed(1)} seconds · loops</FieldDescription>
        </Field>
        <Field orientation="horizontal"><FieldLabel>Image size</FieldLabel>
          <Select value={String(size)} disabled={saving} onValueChange={value => {
            const next = Number(value); setSize(next);
            setFrames(current => Math.min(current, frameOptions.filter(count => next * next * count <= 100_000_000).at(-1)!));
          }}><SelectTrigger aria-label="Image size" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{sizeOptions.map(value => <SelectItem key={value} value={String(value)}>{value} px</SelectItem>)}</SelectGroup></SelectContent>
          </Select></Field>
        {mode !== "trajectory" && <Field orientation="horizontal"><FieldLabel>Animation detail</FieldLabel>
          <Select value={String(frames)} disabled={saving} onValueChange={value => setFrames(Number(value))}>
            <SelectTrigger aria-label="Animation detail" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{frameOptions.filter(value => size * size * value <= 100_000_000).map(value => <SelectItem key={value} value={String(value)}>{value} frames</SelectItem>)}</SelectGroup></SelectContent>
          </Select></Field>}
          </CollapsibleContent>
        </Collapsible>
      </FieldGroup>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-col gap-3">
      <div role="status" className="flex items-center gap-2 text-muted-foreground">
        <span>{busy ? (preview ? "Refining animation…" : "Rendering animation…") : saving ? `Saving GIF · ${Math.round(progress * 100)}%` : saved ? `Saved ${saved.name}` : error ? "Check the error above" : !animation ? "Not rendered yet" : `${range[1] - range[0] + 1} frames · ${((range[1] - range[0] + 1) / fps).toFixed(1)} s`}</span>
      </div>
      {(busy || saving) && <Progress aria-label={busy ? "Rendering animation" : "Saving GIF"} indeterminate={busy} value={busy ? undefined : progress * 100} />}
      <div className="flex flex-wrap items-center gap-2">
        {saved?.downloadUrl && <Button variant="outline" asChild><a href={saved.downloadUrl} download={saved.name}>Download again</a></Button>}
        {error && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Try again</Button>}
        <Button disabled={busy || saving || preview || batchRunning || Boolean(pendingAction)} onClick={() => void save(true)}>Apply GIF to canvas</Button>
        <Button variant="outline" disabled={busy || saving || preview || batchRunning || Boolean(pendingAction)} onClick={() => void save()}><Download data-icon="inline-start" />Save GIF</Button>
      </div>
      {batchControls}
    </div>
  </div>;
}
