import { ScrubNumberField } from "./ui/scrub-number-input";
import { exportXyzrenderFigure } from "../lib/xyzrender-export";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { ArrowRotateCcw, ChevronDown } from "./ui/app-icons";
import { useEffect, useRef, useState } from 'react';

import { Field, FieldLabel, FieldGroup } from './ui/field';

import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import type { AnimationSource } from './xyzrender-animation-dialog';

type RenderedOrientation = { svg: string; orientationRef: string; baseOrientationRef: string };
function MolecularOrientationPanel({ source, onPrepared }: { source: AnimationSource; onPrepared: (source: AnimationSource) => void }) {
  const [angles, setAngles] = useState(source.angles || [0, 0, 0]);
  const [result, setResult] = useState<RenderedOrientation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');


  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(() => () => exportAbort.current?.abort(), []);
  const base = useRef(source.orientationBaseRef || source.orientationRef);

  const latestAngles = useRef(angles);
  latestAngles.current = angles;
  const requestRender = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    let running = false;
    const controller = new AbortController();
    const cache = new Map<string, RenderedOrientation>();
    const render = async () => {
      if (running || disposed) return;
      running = true; setBusy(true); setError('');
      try {
        let renderedKey: string;
        do {
          const requestedAngles = [...latestAngles.current];
          renderedKey = requestedAngles.join(',');
          let body = cache.get(renderedKey);
          if (!body) {
            const response = await fetch('/__burette/xyzrender', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
              body: JSON.stringify({ ...source, previewSvg: undefined, orientationRef: base.current, orientation: requestedAngles }) });
            const payload = await response.json();
            if (!response.ok || !payload.orientationRef) throw new Error(payload.error || 'Could not render this orientation');
            body = payload as RenderedOrientation;
            if (body.svg.length < 250_000) {
              cache.set(renderedKey, body);
              if (cache.size > 16) cache.delete(cache.keys().next().value!);
            }
          }
          if (disposed) return;
          base.current = body.baseOrientationRef; setResult(body);
          // Finish useful work while dragging, then render only the newest angle.
        } while (renderedKey !== latestAngles.current.join(','));
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { running = false; if (!disposed) setBusy(false); }
    };
    requestRender.current = () => { void render(); };
    void render();
    return () => { disposed = true; controller.abort(); requestRender.current = () => {}; };
  }, [source]);
  useEffect(() => { requestRender.current(); }, [angles]);
  const nextSource = () => ({ ...source, previewSvg: result?.svg || source.previewSvg, orientationRef: result?.orientationRef || source.orientationRef, orientationBaseRef: result?.baseOrientationRef || source.orientationBaseRef, angles });
  useEffect(() => { onPrepared(nextSource()); }, [result, source, onPrepared]);
  const apply = () => {
    if (!result) return;
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe.viewer-iframe')) frame.contentWindow?.postMessage({ source: 'burette-host', body: {
      type: 'applyXyzrenderOrientation', itemId: source.itemId, svg: result.svg, orientationRef: result.orientationRef, orientationBaseRef: result.baseOrientationRef, angles, controls: source.controls,
    } }, '*');

  };
  useEffect(() => { if (result) apply(); }, [result]);
  return <div className="flex flex-col gap-4">
    <div>
      <FieldGroup className="xyzrender-angle-fields">{['X', 'Y', 'Z'].map((axis, index) => <Field key={axis} orientation="horizontal" className="xyzrender-angle-row"><FieldLabel>{axis}</FieldLabel>
        <ScrubNumberField aria-label={`${axis} orientation`} formatValue={value => `${value}°`} min={-180} max={180} step={1} smallStep={1} value={angles[index]} onValueChange={value => setAngles(current => current.map((angle, i) => i === index ? value : angle))} className="min-w-0 flex-1" />
      </Field>)}
      </FieldGroup>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {saved && <p role="status" className="text-sm text-muted-foreground">Saved {saved}</p>}
    <div className="flex flex-wrap gap-2">
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" disabled={busy || saving || Boolean(error)}>{saving ? 'Exporting…' : 'Export'}<ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuGroup>{['svg', 'png', 'pdf', 'tiff'].map(format => <DropdownMenuItem key={format} onSelect={() => {
          setSaving(true); setError(''); const controller = new AbortController(); exportAbort.current = controller;
          void exportXyzrenderFigure(nextSource(), format, controller.signal).then(file => setSaved(file.name)).catch(cause => { if (!controller.signal.aborted) setError(String(cause)); }).finally(() => setSaving(false));
        }}>Save {format.toUpperCase()}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setAngles([0, 0, 0])}><ArrowRotateCcw />Reset angles</Button>
</div>
  </div>;
}

export function XyzrenderOrientationPanel(props: { source: AnimationSource; onPrepared: (source: AnimationSource) => void }) {
  const extension = (props.source.inputExtension || props.source.path.split('.').pop() || '').toLowerCase().replace(/^\./, '');
  if (extension === 'cif') return <p className="text-sm text-muted-foreground">Orientation editing is unavailable for periodic structures. Use Animation to rotate the crystal.</p>;
  return <MolecularOrientationPanel {...props} />;
}
