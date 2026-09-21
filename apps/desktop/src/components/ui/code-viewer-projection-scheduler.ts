"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

import { joinEffectKey } from "@/lib/effect-key";
import {
  restoreTextViewerScrollInteractions,
  suspendTextViewerScrollInteractions,
  TEXT_SCROLL_INTERACTION_RESTORE_DELAY_MS,
  type ScrollInteractionSnapshot,
} from "./text-viewer-scroll-interactions";

export function useCodeProjectionScheduler({
  project,
  rowHostRef,
  viewportRef,
}: {
  project: () => boolean | void;
  rowHostRef?: React.RefObject<HTMLPreElement | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}) {
  const scheduledProjectionRef = React.useRef(0);
  const scrollInteractionRestoreRef = React.useRef(0);
  const scrollInteractionSnapshotRef =
    React.useRef<ScrollInteractionSnapshot | null>(null);

  const scheduleProjection = React.useCallback(() => {
    if (scheduledProjectionRef.current) return;
    const runProjection = () => {
      scheduledProjectionRef.current = requestAnimationFrame(() => {
        scheduledProjectionRef.current = 0;
        if (project()) {
          runProjection();
        }
      });
    };
    runProjection();
  }, [project]);

  useKeyedMountEffect(
    joinEffectKey(["code-project", project, scheduleProjection]),
    () => {
      if (project()) {
        scheduleProjection();
      }
      return () => {
        cancelScheduledProjection(scheduledProjectionRef);
      };
    },
  );

  useKeyedMountEffect(
    joinEffectKey([
      "code-project-listeners",
      scheduleProjection,
      rowHostRef,
      viewportRef,
    ]),
    () => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const handleScroll = () => {
        suspendTextViewerScrollInteractions({
          getInteractionTarget: () => rowHostRef?.current,
          getOverflowTarget: () => rowHostRef?.current?.parentElement,
          snapshotRef: scrollInteractionSnapshotRef,
        });
        if (scrollInteractionRestoreRef.current) {
          window.clearTimeout(scrollInteractionRestoreRef.current);
        }
        scrollInteractionRestoreRef.current = window.setTimeout(() => {
          scrollInteractionRestoreRef.current = 0;
          restoreTextViewerScrollInteractions(scrollInteractionSnapshotRef);
        }, TEXT_SCROLL_INTERACTION_RESTORE_DELAY_MS);
        scheduleProjection();
      };

      viewport.addEventListener("scroll", handleScroll, {
        passive: true,
      });
      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(scheduleProjection);
      observer?.observe(viewport);

      return () => {
        viewport.removeEventListener("scroll", handleScroll);
        observer?.disconnect();
        cancelScheduledProjection(scheduledProjectionRef);
        if (scrollInteractionRestoreRef.current) {
          window.clearTimeout(scrollInteractionRestoreRef.current);
          scrollInteractionRestoreRef.current = 0;
        }
        restoreTextViewerScrollInteractions(scrollInteractionSnapshotRef);
      };
    },
  );
}

function cancelScheduledProjection(ref: React.MutableRefObject<number>) {
  if (!ref.current) return;
  cancelAnimationFrame(ref.current);
  ref.current = 0;
}
