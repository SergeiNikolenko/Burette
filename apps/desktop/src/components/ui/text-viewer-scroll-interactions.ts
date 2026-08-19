"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

export const TEXT_SCROLL_INTERACTION_RESTORE_DELAY_MS = 120;

export type ScrollInteractionSnapshot = {
  overflowTarget: HTMLElement | null;
  overflowX: InlineStyleSnapshot | null;
  pointerEvents: InlineStyleSnapshot;
  target: HTMLElement;
};

type InlineStyleSnapshot = {
  priority: string;
  value: string;
};

export function useTextViewerScrollInteractions<Viewport extends HTMLElement>({
  getInteractionTarget,
  getOverflowTarget,
  onScroll,
  viewportRef,
}: {
  getInteractionTarget: () => HTMLElement | null | undefined;
  getOverflowTarget?: () => HTMLElement | null | undefined;
  onScroll: (viewport: Viewport) => void;
  viewportRef: React.RefObject<Viewport | null>;
}) {
  const restoreTimerRef = React.useRef(0);
  const snapshotRef = React.useRef<ScrollInteractionSnapshot | null>(null);

  useKeyedMountEffect(
    joinEffectKey([
      getInteractionTarget,
      getOverflowTarget,
      onScroll,
      viewportRef,
    ]),
    () => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const handleScroll = () => {
        suspendTextViewerScrollInteractions({
          getInteractionTarget,
          getOverflowTarget,
          snapshotRef,
        });
        if (restoreTimerRef.current) {
          window.clearTimeout(restoreTimerRef.current);
        }
        restoreTimerRef.current = window.setTimeout(() => {
          restoreTimerRef.current = 0;
          restoreTextViewerScrollInteractions(snapshotRef);
        }, TEXT_SCROLL_INTERACTION_RESTORE_DELAY_MS);
        onScroll(viewport);
      };

      viewport.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        viewport.removeEventListener("scroll", handleScroll);
        if (restoreTimerRef.current) {
          window.clearTimeout(restoreTimerRef.current);
          restoreTimerRef.current = 0;
        }
        restoreTextViewerScrollInteractions(snapshotRef);
      };
    },
  );
}

export function suspendTextViewerScrollInteractions({
  getInteractionTarget,
  getOverflowTarget,
  snapshotRef,
}: {
  getInteractionTarget: () => HTMLElement | null | undefined;
  getOverflowTarget?: () => HTMLElement | null | undefined;
  snapshotRef: React.MutableRefObject<ScrollInteractionSnapshot | null>;
}) {
  const target = getInteractionTarget();
  if (!target) {
    restoreTextViewerScrollInteractions(snapshotRef);
    return;
  }

  const overflowTarget = isMobileSafari()
    ? (getOverflowTarget?.() ?? target.parentElement ?? target)
    : null;
  const current = snapshotRef.current;
  if (
    current &&
    current.target === target &&
    current.overflowTarget === overflowTarget
  ) {
    target.style.pointerEvents = "none";
    overflowTarget?.style.setProperty("overflow-x", "hidden");
    return;
  }

  restoreTextViewerScrollInteractions(snapshotRef);
  snapshotRef.current = {
    overflowTarget,
    overflowX: overflowTarget
      ? readInlineStyle(overflowTarget, "overflow-x")
      : null,
    pointerEvents: readInlineStyle(target, "pointer-events"),
    target,
  };
  target.style.pointerEvents = "none";
  overflowTarget?.style.setProperty("overflow-x", "hidden");
}

export function restoreTextViewerScrollInteractions(
  snapshotRef: React.MutableRefObject<ScrollInteractionSnapshot | null>,
) {
  const snapshot = snapshotRef.current;
  if (!snapshot) return;

  restoreInlineStyle(snapshot.target, "pointer-events", snapshot.pointerEvents);
  if (snapshot.overflowTarget && snapshot.overflowX) {
    restoreInlineStyle(
      snapshot.overflowTarget,
      "overflow-x",
      snapshot.overflowX,
    );
  }
  snapshotRef.current = null;
}

function isMobileSafari() {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent;
  return (
    /Safari/i.test(userAgent) &&
    /Mobile/i.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS/i.test(userAgent)
  );
}

function readInlineStyle(
  element: HTMLElement,
  propertyName: string,
): InlineStyleSnapshot {
  return {
    priority: element.style.getPropertyPriority(propertyName),
    value: element.style.getPropertyValue(propertyName),
  };
}

function restoreInlineStyle(
  element: HTMLElement,
  propertyName: string,
  snapshot: InlineStyleSnapshot,
) {
  if (!snapshot.value) {
    element.style.removeProperty(propertyName);
    return;
  }
  element.style.setProperty(propertyName, snapshot.value, snapshot.priority);
}
