import { renderXyzrender, saveXyzrenderFile, type SavedXyzrenderFile } from "../lib/xyzrender-transport";
import { createAnimationBudget } from "../lib/xyzrender-animation-budget";
import { useXyzrenderPlayback } from "../hooks/use-xyzrender-playback";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { ScrubNumberField } from "./ui/scrub-number-input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { XyzrenderOrientationPanel } from "./xyzrender-orientation-panel";
import { Switch } from "./ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui/button";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Alert, AlertDescription } from "./ui/alert";
import { ChevronDown, Download, X } from "./ui/app-icons";
import { Progress } from "./ui/progress";
import { safeExportFileName } from "../lib/file-export";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { decodeAnimation, encodeAnimation, type AnimationFrames } from "../lib/xyzrender-animation";

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
type Mode = "rotation" | "bounce" | "trajectory" | "vibration" | "assembly";

type AnimationSettings = { mode: Mode; selectedAxis: string; amplitude: number; rotate: boolean; rebuildBonds: boolean; noise: number; anchor: string; forward: boolean; fps: number; size: number; frames: number };

export function XyzrenderAnimationDialog() {
  const [reserve] = useState(createAnimationBudget);
  const settings = useRef(new Map<string, AnimationSettings>());
  const remember = useCallback((key: string, value: AnimationSettings) => {
    settings.current.set(key, value);
    if (settings.current.size > 32) settings.current.delete(settings.current.keys().next().value!);
  }, []);
  const [source, setSource] = useState<AnimationSource | null>(null);
  const prepared = useRef<AnimationSource | null>(null);
  const prepare = useCallback((next: AnimationSource) => { prepared.current = next; }, []);
  const [animate, setAnimate] = useState(false);
  const [animationSources, setAnimationSources] = useState<AnimationSource[]>([]);
  const retainedSources = useRef(animationSources);
  retainedSources.current = animationSources;
  useEffect(() => {
    if (!source || !animate) return;
    setAnimationSources(previousSources => {
      const current = previousSources.filter(item => item.documentId === source.documentId);
      const key = source.itemId || source.path;
      const existing = current.findIndex(item => (item.itemId || item.path) === key);
      if (existing >= 0) {
        const previous = current[existing];
        // Selection republishes the same source; it must not invalidate a render.
        if (previous.preset === source.preset && previous.orientationRef === source.orientationRef && JSON.stringify(previous.controls) === JSON.stringify(source.controls)) return current;
        return current.map((item, index) => index === existing ? source : item);
      }
      return [...current, source];
    });
  }, [source, animate]);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const open = (event: Event) => { prepared.current = null; setAnimate(false); setSource((event as CustomEvent<AnimationSource>).detail); window.setTimeout(() => { const node = document.getElementById("xyzrender-editor-controls"); setTarget(node); node?.scrollIntoView({ block: "nearest" }); }, 50); };
    window.addEventListener("burette:xyzrender-animation", open);
    const style = (event: Event) => {
      const detail = (event as CustomEvent<AnimationSource>).detail;
      setSource(current => current && (detail.itemId ? current.itemId === detail.itemId : current.path === detail.path || (current.documentId && current.documentId === detail.documentId) || (!current.documentId && current.label === detail.label)) ? { ...current, preset: detail.preset, controls: detail.controls } : current);
    };
    const select = (event: Event) => {
      const next = (event as CustomEvent<AnimationSource>).detail;
      setSource(current => {
        if (!current || current.itemId === next.itemId) return current;
        prepared.current = null;
        return next;
      });
    };
    const remove = (event: Event) => {
      const { itemId } = (event as CustomEvent<{ itemId: string }>).detail;
      settings.current.delete(itemId);
      setAnimationSources(current => current.filter(item => item.itemId !== itemId));
      setSource(current => current?.itemId === itemId ? retainedSources.current.find(item => item.itemId !== itemId) || null : current);
    };
    window.addEventListener("burette:xyzrender-item-removed", remove);
    window.addEventListener("burette:xyzrender-active-item", select);
    window.addEventListener("burette:xyzrender-style", style);
    return () => { window.removeEventListener("burette:xyzrender-item-removed", remove); window.removeEventListener("burette:xyzrender-active-item", select); window.removeEventListener("burette:xyzrender-animation", open); window.removeEventListener("burette:xyzrender-style", style); };
  }, []);
  return source && target ? createPortal(<section className="xyzrender-motion-controls flex flex-col gap-3 border-b border-border py-3">
    <div className="flex items-center justify-between"><strong>Orientation & animation</strong><Button variant="ghost" size="icon-sm" aria-label="Close orientation and animation" onClick={() => setSource(null)}><X /></Button></div>
    <Tabs value={animate ? "animation" : "orientation"} onValueChange={value => { if (value === "animation" && prepared.current) setSource(prepared.current); setAnimate(value === "animation"); }}>
      <TabsList className="w-full"><TabsTrigger value="orientation">Orientation</TabsTrigger><TabsTrigger value="animation">Animation</TabsTrigger></TabsList>
      <TabsContent value="orientation" className="pt-3"><XyzrenderOrientationPanel key={`${source.documentId || source.path}:${source.itemId || ""}`} source={source} onPrepared={prepare} /></TabsContent>
      <TabsContent value="animation" className="pt-3" forceMount hidden={!animate}>
        {animationSources.map(item => <div key={item.itemId || item.path} hidden={(item.itemId || item.path) !== (source.itemId || source.path)}>
          <AnimationContent reserve={reserve} source={item} visible={animate && (item.itemId || item.path) === (source.itemId || source.path)} suspended={!animate && (item.itemId || item.path) === (source.itemId || source.path)} initial={settings.current.get(item.itemId || item.path)} remember={remember} />
        </div>)}
      </TabsContent>
    </Tabs>
  </section>, target) : null;
}

function AnimationContent({ source, reserve, suspended, visible, initial, remember }: { source: AnimationSource; reserve: (key: string, pixels: number) => boolean; suspended: boolean; visible: boolean; initial?: AnimationSettings; remember: (key: string, settings: AnimationSettings) => void }) {
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "rotation");
  const [selectedAxis, setAxis] = useState(initial?.selectedAxis ?? "y");
  // Miller directions need lattice data, not just molecular coordinates.
  const crystalInput = (source.inputExtension || source.path.split('.').pop() || '').toLowerCase().replace(/^\./, '') === 'cif';
  const axis = !crystalInput && /^-?\d{3}$/.test(selectedAxis) ? 'y' : selectedAxis;
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
  const [range, setRange] = useState([0, 239]);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(initial?.fps ?? 60);
  const [size, setSize] = useState(initial?.size ?? 640);
  const [frames, setFrames] = useState(initial?.frames ?? 240);
  useEffect(() => {
    remember(source.itemId || source.path, { mode, selectedAxis, amplitude, rotate, rebuildBonds, noise, anchor, forward, fps, size, frames });
  }, [source.itemId, source.path, remember, mode, selectedAxis, amplitude, rotate, rebuildBonds, noise, anchor, forward, fps, size, frames]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState<SavedXyzrenderFile | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState("");
  const [frame, setFrame] = useXyzrenderPlayback(animation, playing, fps, range, source.itemId, suspended, visible);
  useEffect(() => {
    setAnimation(null); setPlaying(false); setPreview(false);
    const reservationKey = source.itemId || source.path;
    if (!reserve(reservationKey, size * size * frames)) {
      setError("Animation memory is full. Reduce the image size or remove another animated structure.");
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 125_000);
    let disposed = false;
    let retainedPixels = 0;
    setBusy(true); setError(""); setUnavailable(""); setAnimation(null); setPreview(false); setPlaying(false); setSaved(null);
    setFrame(0); setRange([0, frames - 1]);
    const render = async () => {
      try {
        const { label: _label, previewSvg: _preview, ...input } = source;
        // Keep every motion frame from the first pass; refine only spatial resolution.
        // Trajectories retain their source frames, so do not render them twice.
        const passes = mode === "trajectory" ? [size] : [Math.min(size, 256), size];
        let previewCount = 0;
        for (const resolution of passes) {
          const draft = resolution !== size;
          const response = await renderXyzrender({ ...input, animation: { mode, axis, size: resolution, frames, fps: 10, amplitude, rotate, rebuildBonds, noise, anchor, forward } }, controller.signal);
          const payload = await response.json();
          if (!response.ok && (payload.code === 'animation_unavailable' || (mode === 'vibration' && /vibrat|frequen|normal.mode|imaginary/i.test(payload.error || '')))) {
            if (!disposed) setUnavailable(mode === 'trajectory' ? 'This file contains one structure. A trajectory needs at least two coordinate frames.' : 'This file has no supported vibrational mode. Open a frequency calculation to animate vibrations.');
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
          if (!previousCount) setPlaying(true);
          if (draft) previewCount = decoded.frames.length;
        }
      } catch (cause) {
        if (!disposed) setError(controller.signal.aborted ? "Rendering timed out. Try again." : cause instanceof Error ? cause.message : "Could not render this animation. Try another motion or reduce the export size.");
      } finally {
        window.clearTimeout(timeout);
        if (!disposed) { reserve(reservationKey, retainedPixels); setBusy(false); }
      }
    };
    const debounce = window.setTimeout(() => void render(), 350);
    return () => { window.clearTimeout(debounce); disposed = true; controller.abort(); window.clearTimeout(timeout); reserve(reservationKey, 0); };
  }, [source, mode, axis, size, frames, amplitude, rotate, rebuildBonds, noise, anchor, forward, retry, reserve]);
  const position = (index: number) => mode === "rotation"
    ? `${Math.round(index * 360 / (animation?.frames.length || frames))}°`
    : `Frame ${index + 1}`;
  const save = async (applyToCanvas = false) => {
    if (!animation || preview || busy) return;
    const controller = new AbortController(); exportController.current = controller;
    setSaving(true); setPlaying(false); setProgress(0); setError(""); setSaved(null);
    try {
      const bytes = await encodeAnimation(animation, range[0], range[1], fps, setProgress, controller.signal);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      if (applyToCanvas) {
        for (const iframe of document.querySelectorAll<HTMLIFrameElement>('iframe.viewer-iframe')) iframe.contentWindow?.postMessage({ source: 'burette-host', body: { type: 'applyXyzrenderAnimation', itemId: source.itemId, image: 'data:image/gif;base64,' + btoa(binary), commit: true } }, '*');
        return;
      }
      const result = await saveXyzrenderFile(safeExportFileName(`${source.label.replace(/\.[^.]+$/, "")}-${mode}.gif`), "gif", btoa(binary), controller.signal);
      setSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
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
            <Button size="sm" variant="outline" disabled={!animation || saving} onClick={() => setPlaying(value => !value)}>{playing ? "Pause" : "Play"}</Button></div>
          <Slider tone="neutral" aria-label="Molecule rotation" min={0} max={Math.max(1, (animation?.frames.length || frames) - 1)} step={1} value={[frame]} disabled={!animation || saving}
            onValueChange={value => { setPlaying(false); setFrame(value[0]); }} />
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
        <Collapsible><CollapsibleTrigger asChild><Button variant="outline" className="group w-full justify-between h-10"><span>GIF settings</span><span className="ml-auto text-muted-foreground">{size} px · {frames} frames</span><ChevronDown className="transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pt-3">
        <Field><FieldLabel>Export range · {position(range[0])} – {position(range[1])}</FieldLabel>
          <Slider tone="neutral" aria-label="Export frame range" min={0} max={Math.max(1, (animation?.frames.length || frames) - 1)} step={1} minStepsBetweenThumbs={1} value={range} disabled={!animation || animation.frames.length < 2 || saving}
            onValueChange={value => { setRange(value); setFrame(value[0]); setPlaying(false); setSaved(null); }} />
          <FieldDescription>{range[1] - range[0] + 1} frames · {((range[1] - range[0] + 1) / fps).toFixed(1)} seconds · loops</FieldDescription>
        </Field>
        <Field><FieldLabel>Image size</FieldLabel>
          <ToggleGroup type="single" value={String(size)} disabled={saving} onValueChange={value => { if (value) setSize(Number(value)); }} aria-label="Image size">
            <ToggleGroupItem value="480">480 px</ToggleGroupItem><ToggleGroupItem value="640">640 px</ToggleGroupItem>
          </ToggleGroup></Field>
        {mode !== "trajectory" && <Field><FieldLabel>Rotation detail</FieldLabel>
          <ToggleGroup type="single" value={String(frames)} disabled={saving} onValueChange={value => { if (value) setFrames(Number(value)); }} aria-label="Rotation detail">
            <ToggleGroupItem value="120">120 frames</ToggleGroupItem><ToggleGroupItem value="240">240 frames</ToggleGroupItem>
          </ToggleGroup></Field>}
          </CollapsibleContent>
        </Collapsible>
      </FieldGroup>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-col gap-3">
      <div role="status" className="flex items-center gap-2 text-muted-foreground">
        <span>{busy ? (preview ? "Refining animation…" : "Rendering animation…") : saving ? `Saving GIF · ${Math.round(progress * 100)}%` : saved ? `Saved ${saved.name}` : error ? "Check the error above" : `${range[1] - range[0] + 1} frames · ${((range[1] - range[0] + 1) / fps).toFixed(1)} s`}</span>
      </div>
      {(busy || saving) && <Progress aria-label={busy ? "Rendering animation" : "Saving GIF"} indeterminate={busy} value={busy ? undefined : progress * 100} />}
      <div className="flex flex-wrap items-center gap-2">
        {saved?.downloadUrl && <Button variant="outline" asChild><a href={saved.downloadUrl} download={saved.name}>Download again</a></Button>}
        {error && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Try again</Button>}
        <Button disabled={busy || saving || preview || !animation} onClick={() => void save(true)}>Apply GIF to canvas</Button>
        <Button variant="outline" disabled={busy || saving || preview || !animation} onClick={() => void save()}><Download data-icon="inline-start" />Save GIF</Button>
      </div>
    </div>
  </div>;
}
