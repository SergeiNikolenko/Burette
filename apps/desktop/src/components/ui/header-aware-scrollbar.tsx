"use client";

import * as React from "react";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";

export function HeaderAwareScrollbar({
  scrollRef,
  headerHeight,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  headerHeight: number;
}) {
  const scrollElement = useResolvedScrollbarElement(scrollRef);
  const [isVisible, setIsVisible] = React.useState(false);
  const thumbRef = React.useRef<HTMLDivElement>(null);
  const thumbMetrics = React.useRef({ height: 0, top: 0 });
  const drag = React.useRef<{ y: number; scroll: number } | null>(null);
  const frame = React.useRef(0);

  const measure = React.useCallback(() => {
    frame.current = 0;
    if (!scrollElement) {
      hideThumb(setIsVisible);
      return;
    }
    const { scrollHeight, clientHeight, scrollTop } = scrollElement;
    if (
      !Number.isFinite(scrollHeight) ||
      !Number.isFinite(clientHeight) ||
      !Number.isFinite(scrollTop) ||
      !Number.isFinite(headerHeight)
    ) {
      hideThumb(setIsVisible);
      return;
    }
    const track = clientHeight - headerHeight;
    if (scrollHeight <= clientHeight + 1 || track <= 0) {
      hideThumb(setIsVisible);
      return;
    }
    const height = Math.max(28, (clientHeight / scrollHeight) * track);
    const maxScroll = scrollHeight - clientHeight;
    const maxTop = track - height;
    const top =
      maxScroll > 0
        ? clampScrollTop((scrollTop / maxScroll) * maxTop, maxTop)
        : 0;
    thumbMetrics.current = { height, top };
    applyThumbStyle(thumbRef.current, thumbMetrics.current);
    setIsVisible((current) => (current ? current : true));
  }, [scrollElement, headerHeight]);

  const scheduleMeasure = React.useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  useKeyedMountEffect(
    joinEffectKey([scrollElement, measure, scheduleMeasure]),
    () => {
      if (!scrollElement) {
        hideThumb(setIsVisible);
        return;
      }
      measure();
      scrollElement.addEventListener("scroll", scheduleMeasure, {
        passive: true,
      });
      const observer =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(scheduleMeasure)
          : null;
      observer?.observe(scrollElement);
      return () => {
        if (frame.current) cancelAnimationFrame(frame.current);
        scrollElement.removeEventListener("scroll", scheduleMeasure);
        observer?.disconnect();
      };
    },
  );

  useKeyedLayoutEffect(joinEffectKey([isVisible]), () => {
    applyThumbStyle(thumbRef.current, thumbMetrics.current);
  });

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrollElement) return;
    event.preventDefault();
    drag.current = { y: event.clientY, scroll: scrollElement.scrollTop };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const currentDrag = drag.current;
    if (!scrollElement || !currentDrag) return;
    const track = scrollElement.clientHeight - headerHeight;
    const height = Math.max(
      28,
      (scrollElement.clientHeight / scrollElement.scrollHeight) * track,
    );
    const denominator = track - height;
    if (denominator <= 0) return;
    const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
    scrollElement.scrollTop = clampScrollTop(
      currentDrag.scroll +
        ((event.clientY - currentDrag.y) / denominator) * maxScroll,
      maxScroll,
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  if (!isVisible) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-0 z-30 w-2.5"
      style={{ top: headerHeight, bottom: 0 }}
    >
      <div
        ref={thumbRef}
        className="bg-foreground/25 hover:bg-foreground/40 pointer-events-auto absolute right-0.5 w-1.5 rounded-full transition-colors"
        style={{
          top: 0,
          height: thumbMetrics.current.height,
          transform: `translateY(${thumbMetrics.current.top}px)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  );
}

function useResolvedScrollbarElement(
  scrollRef: React.RefObject<HTMLDivElement | null>,
) {
  const [scrollElement, setScrollElement] = React.useState(scrollRef.current);

  useKeyedLayoutEffect(
    joinEffectKey([scrollRef, scrollRef.current, scrollElement]),
    () => {
      const nextScrollElement = scrollRef.current;
      if (scrollElement !== nextScrollElement) {
        setScrollElement(nextScrollElement);
      }
    },
  );

  return scrollElement;
}

function hideThumb(setThumb: React.Dispatch<React.SetStateAction<boolean>>) {
  setThumb((current) => (current ? false : current));
}

function clampScrollTop(value: number, maxScroll: number) {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(maxScroll) || maxScroll <= 0) return 0;
  return Math.min(maxScroll, Math.max(0, value));
}

function applyThumbStyle(
  element: HTMLDivElement | null,
  metrics: { height: number; top: number },
) {
  if (!element) return;
  element.style.height = `${metrics.height}px`;
  element.style.transform = `translateY(${metrics.top}px)`;
}
