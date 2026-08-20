"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";

import {
  getPdfThumbnailLayoutItem,
  normalizeThumbnailPage,
  type PdfThumbnailLayout,
} from "./pdf-thumbnail-layout";
import { joinEffectKey } from "@/lib/effect-key";

export const THUMBNAIL_FOLLOW_MARGIN = 24;

type ThumbnailFollowSuspension =
  | { kind: "none" }
  | { kind: "pointer" }
  | { kind: "user-scroll" }
  | { kind: "rail-navigation"; targetPage: number };

interface ThumbnailFollowState {
  suspension: ThumbnailFollowSuspension;
  currentPage: number | null;
  programmaticScrollCount: number;
}

export function useThumbnailRailFollow({
  currentPage,
  layout,
  viewportRef,
  resetKey,
}: {
  currentPage: number | null | undefined;
  layout: PdfThumbnailLayout;
  viewportRef: React.RefObject<HTMLElement | null>;
  resetKey: unknown;
}) {
  const stateRef = React.useRef<ThumbnailFollowState>({
    suspension: { kind: "none" },
    currentPage: null,
    programmaticScrollCount: 0,
  });

  const scrollPageIntoView = React.useCallback(
    (page: number, behavior: ScrollBehavior) => {
      const normalizedPage = normalizeThumbnailPage(page, layout.pageCount);
      if (normalizedPage == null) return false;

      const viewport = viewportRef.current;
      if (!viewport) return false;

      const item = getPdfThumbnailLayoutItem(layout, normalizedPage);
      if (!item) return false;

      const top = item.top - viewport.scrollTop;
      const bottom = top + item.height;
      const minTop = THUMBNAIL_FOLLOW_MARGIN;
      const maxBottom = viewport.clientHeight - THUMBNAIL_FOLLOW_MARGIN;
      const isAtDocumentStart =
        item.top <= THUMBNAIL_FOLLOW_MARGIN &&
        viewport.scrollTop <= THUMBNAIL_FOLLOW_MARGIN;

      if ((top >= minTop || isAtDocumentStart) && bottom <= maxBottom) {
        return false;
      }

      const maxScrollTop = Math.max(
        0,
        layout.totalHeight - viewport.clientHeight,
      );
      const targetTop = Math.min(
        maxScrollTop,
        Math.max(0, item.top - viewport.clientHeight / 2 + item.height / 2),
      );

      if (stateRef.current.suspension.kind !== "rail-navigation") {
        stateRef.current.programmaticScrollCount += 1;
      }
      viewport.scrollTo?.({ top: targetTop, behavior });
      return true;
    },
    [layout, viewportRef],
  );

  const followNow = React.useCallback(() => {
    const page = normalizeThumbnailPage(currentPage, layout.pageCount);
    if (page == null) return;

    const state = stateRef.current;
    if (state.suspension.kind !== "none") return;

    scrollPageIntoView(page, "auto");
  }, [currentPage, layout.pageCount, scrollPageIntoView]);

  useKeyedMountEffect(joinEffectKey(["thumbnail-reset", resetKey]), () => {
    const state = stateRef.current;
    state.suspension = { kind: "none" };
    state.currentPage = null;
    state.programmaticScrollCount = 0;
  });

  useKeyedMountEffect(
    joinEffectKey(["thumbnail-follow", followNow, resetKey]),
    () => {
      const page = normalizeThumbnailPage(currentPage, layout.pageCount);
      const state = stateRef.current;
      const pageChanged = state.currentPage !== page;

      state.currentPage = page;
      if (state.suspension.kind === "rail-navigation") {
        if (pageChanged || page === state.suspension.targetPage) {
          state.suspension = { kind: "none" };
          followNow();
        }
        return;
      }

      if (state.suspension.kind === "user-scroll" && pageChanged) {
        state.suspension = { kind: "none" };
      }

      followNow();
    },
  );

  const onPointerEnter = React.useCallback(() => {
    const state = stateRef.current;
    if (
      state.suspension.kind === "user-scroll" ||
      state.suspension.kind === "rail-navigation"
    ) {
      return;
    }
    state.suspension = { kind: "pointer" };
  }, []);

  const onPointerLeave = React.useCallback(() => {
    const state = stateRef.current;
    if (state.suspension.kind !== "pointer") return;
    state.suspension = { kind: "none" };
    followNow();
  }, [followNow]);

  const onPageActivate = React.useCallback(
    (pageNumber: number) => {
      const targetPage = normalizeThumbnailPage(pageNumber, layout.pageCount);
      if (targetPage == null) return;

      const state = stateRef.current;
      state.suspension =
        state.currentPage === targetPage
          ? { kind: "none" }
          : { kind: "rail-navigation", targetPage };
      scrollPageIntoView(targetPage, "smooth");
    },
    [layout.pageCount, scrollPageIntoView],
  );

  const onScroll = React.useCallback(() => {
    const state = stateRef.current;
    if (state.programmaticScrollCount > 0) {
      state.programmaticScrollCount -= 1;
      return;
    }

    if (state.suspension.kind === "rail-navigation") return;

    state.suspension = { kind: "user-scroll" };
  }, []);

  return {
    onPageActivate,
    onPointerEnter,
    onPointerLeave,
    onScroll,
  };
}
