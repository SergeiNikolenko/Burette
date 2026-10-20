import { useEffect, useId, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { ContextualGuideCard } from "./contextual-guide-card";
import { contextualGuides, isContextualGuideId } from "./contextual-guides";
import { releaseContextualGuide, resetOnboardingEvent } from "./progress";
import {
  contextualGuideMessageType, contextualGuideRequestEvent, registerContextualGuideHost, requestContextualGuide,
  type ContextualGuideRequest, type GuideRect,
} from "./request";

const toDomRect = (rect: GuideRect) => new DOMRect(rect.left, rect.top, rect.width, rect.height);

// Frames report rects in their own viewport; walk up to this document.
function frameOffset(source: Window): { left: number; top: number } | null {
  let left = 0, top = 0, current: Window | null = source;
  for (let depth = 0; current && current !== window && depth < 4; depth += 1) {
    const child: Window = current;
    let frame: Element | null = null;
    try { frame = child.frameElement; } catch { frame = null; }
    frame ??= [...document.querySelectorAll("iframe")].find(item => item.contentWindow === child) ?? null;
    if (!frame) return null;
    const box = frame.getBoundingClientRect();
    left += box.left + frame.clientLeft;
    top += box.top + frame.clientTop;
    current = child.parent;
  }
  return current === window ? { left, top } : null;
}

const isRect = (value: unknown): value is GuideRect => !!value && typeof value === "object"
  && ["left", "top", "width", "height"].every(key => Number.isFinite((value as Record<string, unknown>)[key]));

export function ContextualGuideHost() {
  const [active, setActive] = useState<ContextualGuideRequest | null>(null);
  const titleId = useId();

  useEffect(() => {
    const unregister = registerContextualGuideHost();
    const show = (event: Event) => setActive((event as CustomEvent<ContextualGuideRequest>).detail);
    const fromFrame = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; id?: unknown; rect?: unknown } | null;
      if (data?.type !== contextualGuideMessageType || !isContextualGuideId(data.id) || !event.source) return;
      const offset = frameOffset(event.source as Window);
      if (!offset) return;
      const rect = isRect(data.rect) ? { ...data.rect, left: data.rect.left + offset.left, top: data.rect.top + offset.top } : null;
      requestContextualGuide(data.id, rect);
    };
    const reset = () => setActive(null);
    window.addEventListener(contextualGuideRequestEvent, show);
    window.addEventListener("message", fromFrame);
    window.addEventListener(resetOnboardingEvent, reset);
    return () => {
      unregister();
      window.removeEventListener(contextualGuideRequestEvent, show);
      window.removeEventListener("message", fromFrame);
      window.removeEventListener(resetOnboardingEvent, reset);
    };
  }, []);

  const anchor = active?.anchor ?? null;
  const virtualRef = useMemo(() => ({
    current: { getBoundingClientRect: () => anchor instanceof Element ? anchor.getBoundingClientRect() : toDomRect(anchor ?? { left: 0, top: 0, width: 0, height: 0 }) },
  }), [anchor]);
  if (!active) return null;
  const close = () => { releaseContextualGuide(active.id); setActive(null); };
  const card = (title?: typeof DialogTitle) => <ContextualGuideCard key={active.id} id={active.id} onDone={close} title={title} titleId={titleId} />;

  if (contextualGuides[active.id].pattern === "announcement" || !anchor) {
    return <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent variant="form" size="default" className="gap-0 overflow-hidden p-0" aria-describedby={undefined}>{card(DialogTitle)}</DialogContent>
    </Dialog>;
  }
  return <Popover open onOpenChange={open => { if (!open) close(); }}>
    <PopoverAnchor virtualRef={virtualRef} />
    {/* A guide never takes focus from the control the user just used. */}
    <PopoverContent side="bottom" align="center" sideOffset={8} disablePadding aria-labelledby={titleId}
      className="w-90 max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl" onOpenAutoFocus={event => event.preventDefault()}>
      {card()}
    </PopoverContent>
  </Popover>;
}
