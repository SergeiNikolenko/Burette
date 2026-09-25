import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { clearRegionSelection, clickTargetBox, controlAt, deliverAnnotations, describeRegion, type Annotation, type RegionGranularity, type RegionRect, type RegionTarget } from "../lib/annotation-region";
import { useAnnotationStore } from "../stores/annotation-store";
import { ShortcutTooltip } from "./shortcut-tooltip";
import { Annotate, Check } from "./ui/app-icons";
import "./annotation-layer.css";

// Annotate mode, modelled on the Codex file viewer: drag a region (or click an
// element), describe the change in the composer beside the pin and collect as
// many annotations as needed. Mol* selects the atoms or residues each region
// covers. Menus and toolbars stay live; only the scene takes annotations. In
// the Codex widget Send posts the batch as one chat message with a marked-up
// frame of the view; elsewhere Send copies it.

const CLICK_BOX = 16;
const MAX_ANNOTATIONS = 20;
const COMPOSER_WIDTH = 320;

// `target` is undefined until the region is read; clicks read it at once so a
// viewer can snap the box to the element under the pointer.
type Draft = { key: number; rect: RegionRect; pin: { x: number; y: number }; comment: string; element: boolean; id?: number; target?: RegionTarget | null };
type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "done"; message: string } | { kind: "error"; message: string };

export function AnnotateToggle({ className }: { className?: string }) {
  const active = useAnnotationStore((state) => state.active);
  const toggle = useAnnotationStore((state) => state.toggle);
  return (
    <button type="button" className={`annotate-toggle ${className ?? ""}`} data-active={active || undefined} aria-pressed={active}
      aria-label={active ? "Stop annotating" : "Annotate this view"} onMouseDown={(event) => event.preventDefault()} onClick={toggle}>
      <Annotate size={18} aria-hidden />
      {active ? <span>Annotating</span> : null}
      <ShortcutTooltip label={active ? "Annotating" : "Annotate this view"} shortcut={active ? undefined : "⌘."} />
    </button>
  );
}

export function AnnotationLayer({ documentTitle, picksResidues }: { documentTitle: string; picksResidues: boolean }) {
  const active = useAnnotationStore((state) => state.active);
  const setActive = useAnnotationStore((state) => state.setActive);
  const layerRef = useRef<HTMLDivElement>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [barOffset, setBarOffset] = useState({ x: 0, y: 0 });
  const [granularity, setGranularity] = useState<RegionGranularity>("atom");
  // Over a menu or toolbar the surface steps aside so the control takes the click.
  const [passthrough, setPassthrough] = useState(false);
  const nextId = useRef(1);
  const draftKey = useRef(0);
  const closeTimer = useRef(0);
  const annotationsRef = useRef<Annotation[]>([]);
  annotationsRef.current = annotations;

  useEffect(() => {
    if (active) return;
    clearRegionSelection(annotationsRef.current);
    setAnnotations([]); setDrag(null); setDraft(null); setPhase({ kind: "idle" }); setBarOffset({ x: 0, y: 0 }); setPassthrough(false);
    window.clearTimeout(closeTimer.current);
  }, [active]);

  // While stepped aside, pointer moves in the page and in the viewer frames tell
  // when the pointer is back over the scene.
  useEffect(() => {
    const layer = layerRef.current;
    if (!active || !passthrough || !layer) return;
    const check = (x: number, y: number) => { if (!controlAt(layer, x, y)) setPassthrough(false); };
    const onMove = (event: PointerEvent) => check(event.clientX, event.clientY);
    document.addEventListener("pointermove", onMove, true);
    const detach = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe.viewer-iframe")).map((frame) => {
      let inner: Document | null = null;
      try { inner = frame.contentDocument; } catch { /* cross-origin frames report nothing */ }
      const onFrameMove = (event: PointerEvent) => {
        const rect = frame.getBoundingClientRect();
        check(event.clientX + rect.left, event.clientY + rect.top);
      };
      inner?.addEventListener("pointermove", onFrameMove, true);
      return () => inner?.removeEventListener("pointermove", onFrameMove, true);
    });
    return () => {
      document.removeEventListener("pointermove", onMove, true);
      for (const remove of detach) remove();
    };
  }, [active, passthrough]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (draft) setDraft(null);
      else if (drag) setDrag(null);
      else if (!annotations.length) setActive(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, annotations.length, draft, drag, setActive]);

  if (!active) return null;
  const bounds = layerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  const local = (rect: RegionRect) => ({ left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height });
  const busy = capturing || phase.kind === "sending" || phase.kind === "done";

  async function commitDraft(current: Draft) {
    const comment = current.comment.trim().slice(0, 2000);
    setDraft(null);
    if (current.id != null) {
      setAnnotations(comment ? annotations.map((item) => item.id === current.id ? { ...item, comment } : item) : annotations.filter((item) => item.id !== current.id));
      return;
    }
    if (!comment || !layerRef.current) return;
    setCapturing(true);
    try {
      const target = current.target !== undefined ? current.target : await describeRegion(layerRef.current, current.rect, granularity);
      setAnnotations([...annotations, { id: nextId.current++, rect: current.rect, pin: current.pin, comment, target }].slice(0, MAX_ANNOTATIONS));
    } finally {
      setCapturing(false);
    }
  }

  function onSurfaceMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag) setDrag({ ...drag, x1: event.clientX, y1: event.clientY });
    else if (layerRef.current && controlAt(layerRef.current, event.clientX, event.clientY)) setPassthrough(true);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || busy) return;
    if (draft?.comment.trim()) void commitDraft(draft);
    else setDraft(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || !layerRef.current) return;
    setDrag(null);
    const rect = { left: Math.min(drag.x0, event.clientX), top: Math.min(drag.y0, event.clientY),
      width: Math.abs(event.clientX - drag.x0), height: Math.abs(event.clientY - drag.y0) };
    const key = ++draftKey.current;
    // The region is read at once so the viewer shows its selection while the
    // comment is written.
    if (rect.width >= 4 || rect.height >= 4) {
      setDraft({ key, rect, pin: { x: event.clientX, y: event.clientY }, comment: "", element: false });
      void describeRegion(layerRef.current, rect, granularity).then((target) => setDraft((current) => current?.key === key ? { ...current, target } : current));
      return;
    }
    const box = clickTargetBox(layerRef.current, event.clientX, event.clientY);
    const clicked = box ?? { left: event.clientX - CLICK_BOX / 2, top: event.clientY - CLICK_BOX / 2, width: CLICK_BOX, height: CLICK_BOX };
    setDraft({ key, rect: clicked, pin: { x: clicked.left + clicked.width, y: clicked.top }, comment: "", element: Boolean(box) });
    if (box) return;
    void describeRegion(layerRef.current, clicked, granularity).then((target) => setDraft((current) => {
      if (current?.key !== key) return current;
      const snapped = target?.box ?? current.rect;
      return { ...current, target, rect: snapped, element: Boolean(target?.box), pin: target?.box ? { x: snapped.left + snapped.width, y: snapped.top } : current.pin };
    }));
  }

  async function send() {
    setPhase({ kind: "sending" });
    try {
      const delivery = await deliverAnnotations(documentTitle, annotations);
      setPhase({ kind: "done", message: delivery === "sent" ? "Sent to the chat" : "Copied. Paste into your agent chat" });
      closeTimer.current = window.setTimeout(() => setActive(false), 1200);
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function startBarDrag(event: ReactPointerEvent<HTMLSpanElement>) {
    const origin = { x: event.clientX - barOffset.x, y: event.clientY - barOffset.y };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => setBarOffset({ x: next.clientX - origin.x, y: next.clientY - origin.y });
    const end = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", end); };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
  }

  const dragRect = drag ? local({ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }) : null;
  const composerLeft = draft ? (draft.pin.x - bounds.left + 20 + COMPOSER_WIDTH > bounds.width ? draft.pin.x - bounds.left - 20 - COMPOSER_WIDTH : draft.pin.x - bounds.left + 20) : 0;
  const count = annotations.length;

  return (
    <div ref={layerRef} className="annotation-layer" data-capturing={capturing || undefined}>
      <div className="annotation-surface" data-passthrough={passthrough || undefined} onPointerDown={onPointerDown} onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)} onPointerMove={onSurfaceMove} />
      {annotations.map((annotation, index) => draft?.id === annotation.id ? null : (
        <div key={annotation.id}>
          <div className="annotation-region" style={local(annotation.rect)} />
          <button type="button" className="annotation-pin" style={{ left: annotation.pin.x - bounds.left, top: annotation.pin.y - bounds.top }}
            aria-label={`Edit annotation ${index + 1}: ${annotation.comment}`} title={annotation.comment} disabled={busy}
            onClick={() => setDraft({ key: ++draftKey.current, rect: annotation.rect, pin: annotation.pin, comment: annotation.comment, element: false, id: annotation.id })}>
            {index + 1}
          </button>
        </div>
      ))}
      {dragRect ? <div className="annotation-region" style={dragRect} /> : null}
      {draft ? <>
        <div className="annotation-region" data-element={draft.element || undefined} style={local(draft.rect)} />
        <span className="annotation-pin" aria-hidden style={{ left: draft.pin.x - bounds.left, top: draft.pin.y - bounds.top }} />
        <form className="annotation-composer" style={{ left: Math.max(8, composerLeft), top: Math.min(Math.max(8, draft.pin.y - bounds.top - 20), bounds.height - 48) }}
          onSubmit={(event) => { event.preventDefault(); void commitDraft(draft); }}>
          <input autoFocus value={draft.comment} maxLength={2000} placeholder="Describe a change or ask a question" aria-label="Annotation comment"
            onChange={(event) => setDraft({ ...draft, comment: event.target.value })}
            onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); setDraft(null); } }} />
          <button type="submit" className="annotation-submit" aria-label="Add annotation" disabled={!draft.comment.trim() && draft.id == null}>
            <Check size={16} aria-hidden />
          </button>
        </form>
      </> : null}
      <div className="annotation-bar" role="toolbar" aria-label="Annotations" style={{ transform: `translate(calc(-50% + ${barOffset.x}px), ${barOffset.y}px)` }}>
        {phase.kind === "done" ? <span className="annotation-bar-label">{phase.message}</span> : <>
          <span className="annotation-grip" aria-hidden onPointerDown={startBarDrag} />
          {picksResidues ? <span className="annotation-granularity" role="radiogroup" aria-label="Select in the structure">
            {(["atom", "residue"] as const).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={granularity === value} data-active={granularity === value || undefined}
                disabled={busy} onClick={() => setGranularity(value)}>
                {value === "atom" ? "Atoms" : "Residues"}
              </button>
            ))}
          </span> : null}
          <span className="annotation-bar-label" data-error={phase.kind === "error" || undefined}>
            {phase.kind === "error" ? `Could not send: ${phase.message}` : phase.kind === "sending" ? "Sending…" : capturing ? "Reading the region…" : count ? `${count} annotation${count === 1 ? "" : "s"}` : "Select content and ask for changes"}
          </span>
          {count ? <span className="annotation-bar-divider" aria-hidden /> : null}
          <button type="button" className="annotation-cancel" disabled={phase.kind === "sending"} onClick={() => setActive(false)}>Cancel</button>
          {count ? <button type="button" className="annotation-send" disabled={busy || Boolean(draft)} onClick={() => void send()}>
            {phase.kind === "error" ? "Retry" : "Send"}
          </button> : null}
        </>}
      </div>
    </div>
  );
}
