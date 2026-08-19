"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { cn } from "@/lib/utils";
import type { XlsxSheetMeta } from "@/lib/xlsx-workbook";

import { joinEffectKey } from "@/lib/effect-key";

export const XLSX_SHEET_TABS_HEIGHT_PX = 36;
const TAB_HEIGHT_PX = 28;
const SCROLL_EPSILON_PX = 1;
const TAB_MIN_WIDTH_PX = 92;
const TAB_MAX_WIDTH_PX = 184;
const TAB_GAP_PX = 2;
const TAB_SCROLL_INLINE_PADDING_PX = 12;
const PREFERRED_VISIBLE_TABS = 6;
const LARGE_REVEAL_DISTANCE_MULTIPLIER = 1.25;
const OVERFLOW_REVEAL_DESKTOP_PX = 22;
const OVERFLOW_REVEAL_MOBILE_PX = 16;
const OVERFLOW_REVEAL_MIN_PX = 8;

interface SheetTabScrollState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  isOverflowing: boolean;
  viewportWidth: number;
}

interface TabRevealGeometry {
  activeIndex: number;
  activeLeft: number;
  activeWidth: number;
  scrollLeft: number;
  scrollWidth: number;
  sheetCount: number;
  viewportWidth: number;
}

function scrollTabsTo(
  scrollElement: HTMLDivElement,
  left: number,
  behavior: ScrollBehavior,
) {
  const maxScrollLeft = Math.max(
    0,
    scrollElement.scrollWidth - scrollElement.clientWidth,
  );
  const clampedLeft = Math.min(maxScrollLeft, Math.max(0, left));

  if (typeof scrollElement.scrollTo === "function") {
    scrollElement.scrollTo({ left: clampedLeft, behavior });
  } else {
    scrollElement.scrollLeft = clampedLeft;
  }
}

function resolveOverflowRevealPx(viewportWidth: number, tabWidth: number) {
  const targetReveal = resolveOverflowRevealTargetPx(viewportWidth);
  const maxTabReveal = Math.max(
    OVERFLOW_REVEAL_MIN_PX,
    Math.floor(tabWidth * 0.35),
  );

  return Math.max(OVERFLOW_REVEAL_MIN_PX, Math.min(targetReveal, maxTabReveal));
}

function resolveOverflowRevealTargetPx(viewportWidth: number) {
  return viewportWidth <= 420
    ? OVERFLOW_REVEAL_MOBILE_PX
    : OVERFLOW_REVEAL_DESKTOP_PX;
}

function resolveTabRevealScrollLeft({
  activeIndex,
  activeLeft,
  activeWidth,
  scrollLeft,
  scrollWidth,
  sheetCount,
  viewportWidth,
}: TabRevealGeometry) {
  const maxScrollLeft = Math.max(0, scrollWidth - viewportWidth);
  if (maxScrollLeft <= SCROLL_EPSILON_PX) return 0;

  if (activeIndex <= 0) return 0;
  if (activeIndex >= sheetCount - 1) return maxScrollLeft;

  const activeRight = activeLeft + activeWidth;
  const overflowRevealPx = resolveOverflowRevealPx(viewportWidth, activeWidth);
  const visibleLeft = scrollLeft + overflowRevealPx;
  const visibleRight = scrollLeft + viewportWidth - overflowRevealPx;

  let nextScrollLeft = scrollLeft;

  if (activeLeft < visibleLeft) {
    nextScrollLeft = activeLeft - overflowRevealPx;
  } else if (activeRight > visibleRight) {
    nextScrollLeft = activeRight - viewportWidth + overflowRevealPx;
  }

  return Math.min(maxScrollLeft, Math.max(0, nextScrollLeft));
}

function readScrollState(scrollElement: HTMLElement): SheetTabScrollState {
  const maxScrollLeft = Math.max(
    0,
    scrollElement.scrollWidth - scrollElement.clientWidth,
  );

  return {
    canScrollLeft: scrollElement.scrollLeft > SCROLL_EPSILON_PX,
    canScrollRight:
      scrollElement.scrollLeft < maxScrollLeft - SCROLL_EPSILON_PX,
    isOverflowing: maxScrollLeft > SCROLL_EPSILON_PX,
    viewportWidth: scrollElement.clientWidth,
  };
}

function resolveTabWidth(viewportWidth: number, sheetCount: number) {
  if (viewportWidth <= 0 || sheetCount <= 0) return undefined;

  const preferredVisibleTabs = Math.min(sheetCount, PREFERRED_VISIBLE_TABS);
  const isOverflowing = sheetCount > preferredVisibleTabs;
  const overflowRevealPx = isOverflowing
    ? resolveOverflowRevealTargetPx(viewportWidth)
    : 0;
  const visibleTabs = isOverflowing
    ? Math.max(
        1,
        Math.min(
          preferredVisibleTabs,
          Math.floor(
            (viewportWidth -
              TAB_SCROLL_INLINE_PADDING_PX -
              overflowRevealPx +
              TAB_GAP_PX) /
              (TAB_MIN_WIDTH_PX + TAB_GAP_PX),
          ),
        ),
      )
    : preferredVisibleTabs;
  const gapCount = isOverflowing ? visibleTabs : Math.max(0, sheetCount - 1);
  const availableWidth = Math.max(
    0,
    viewportWidth -
      TAB_SCROLL_INLINE_PADDING_PX -
      gapCount * TAB_GAP_PX -
      overflowRevealPx,
  );

  return Math.round(
    Math.min(
      TAB_MAX_WIDTH_PX,
      Math.max(TAB_MIN_WIDTH_PX, availableWidth / visibleTabs),
    ),
  );
}

export function XlsxSheetTabs({
  sheets,
  activeSheetIndex,
  onSelectSheet,
}: {
  sheets: XlsxSheetMeta[];
  activeSheetIndex: number;
  onSelectSheet: (sheetIndex: number) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [scrollState, setScrollState] = React.useState<SheetTabScrollState>({
    canScrollLeft: false,
    canScrollRight: false,
    isOverflowing: false,
    viewportWidth: 0,
  });
  const tabWidth = resolveTabWidth(scrollState.viewportWidth, sheets.length);

  const updateScrollState = React.useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const nextScrollState = readScrollState(scrollElement);

    setScrollState((current) =>
      current.canScrollLeft === nextScrollState.canScrollLeft &&
      current.canScrollRight === nextScrollState.canScrollRight &&
      current.isOverflowing === nextScrollState.isOverflowing &&
      current.viewportWidth === nextScrollState.viewportWidth
        ? current
        : nextScrollState,
    );
  }, []);

  const scrollTabsBy = React.useCallback(
    (delta: number) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return false;

      const maxScrollLeft = Math.max(
        0,
        scrollElement.scrollWidth - scrollElement.clientWidth,
      );
      const nextScrollLeft = scrollElement.scrollLeft + delta;
      const clampedScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, nextScrollLeft),
      );

      if (Math.abs(clampedScrollLeft - scrollElement.scrollLeft) <= 0.5) {
        return false;
      }

      scrollElement.scrollLeft = clampedScrollLeft;
      updateScrollState();
      return true;
    },
    [updateScrollState],
  );

  const onTabsWheel = React.useCallback(
    (event: WheelEvent) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement || !readScrollState(scrollElement).isOverflowing) {
        return;
      }

      const dominantDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (dominantDelta === 0) return;

      if (!scrollTabsBy(dominantDelta)) return;
      event.preventDefault();
    },
    [scrollTabsBy],
  );

  useKeyedMountEffect(
    joinEffectKey([
      "xlsx-tabs-listeners",
      onTabsWheel,
      sheets.length,
      updateScrollState,
    ]),
    () => {
      updateScrollState();

      const scrollElement = scrollRef.current;
      const listElement = listRef.current;
      if (!scrollElement) return;

      const ResizeObserverCtor = globalThis.ResizeObserver;
      const resizeObserver =
        typeof ResizeObserverCtor === "function"
          ? new ResizeObserverCtor(updateScrollState)
          : null;
      resizeObserver?.observe(scrollElement);
      if (listElement) resizeObserver?.observe(listElement);

      scrollElement.addEventListener("scroll", updateScrollState, {
        passive: true,
      });
      scrollElement.addEventListener("wheel", onTabsWheel, { passive: false });
      return () => {
        resizeObserver?.disconnect();
        scrollElement.removeEventListener("scroll", updateScrollState);
        scrollElement.removeEventListener("wheel", onTabsWheel);
      };
    },
  );

  useKeyedMountEffect(
    joinEffectKey([
      "xlsx-tabs-active",
      activeSheetIndex,
      sheets.length,
      tabWidth,
      updateScrollState,
    ]),
    () => {
      const scrollElement = scrollRef.current;
      const activeTab = tabRefs.current[activeSheetIndex];
      if (!scrollElement || !activeTab) return;

      const nextLeft = resolveTabRevealScrollLeft({
        activeIndex: activeSheetIndex,
        activeLeft: activeTab.offsetLeft,
        activeWidth: activeTab.offsetWidth,
        scrollLeft: scrollElement.scrollLeft,
        scrollWidth: scrollElement.scrollWidth,
        sheetCount: sheets.length,
        viewportWidth: scrollElement.clientWidth,
      });

      if (Math.abs(nextLeft - scrollElement.scrollLeft) > SCROLL_EPSILON_PX) {
        const distance = Math.abs(nextLeft - scrollElement.scrollLeft);
        scrollTabsTo(
          scrollElement,
          nextLeft,
          distance >
            scrollElement.clientWidth * LARGE_REVEAL_DISTANCE_MULTIPLIER
            ? "auto"
            : "smooth",
        );
      }

      window.requestAnimationFrame(updateScrollState);
    },
  );

  if (sheets.length <= 1) return null;

  const selectSheet = (sheetIndex: number) => {
    if (sheetIndex !== activeSheetIndex) onSelectSheet(sheetIndex);
  };

  const onTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    sheetIndex: number,
  ) => {
    const lastSheetIndex = sheets.length - 1;
    let nextSheetIndex: number | null = null;

    if (event.key === "ArrowLeft") {
      nextSheetIndex = sheetIndex > 0 ? sheetIndex - 1 : lastSheetIndex;
    } else if (event.key === "ArrowRight") {
      nextSheetIndex = sheetIndex < lastSheetIndex ? sheetIndex + 1 : 0;
    } else if (event.key === "Home") {
      nextSheetIndex = 0;
    } else if (event.key === "End") {
      nextSheetIndex = lastSheetIndex;
    }

    if (nextSheetIndex == null) return;
    event.preventDefault();
    selectSheet(nextSheetIndex);
    tabRefs.current[nextSheetIndex]?.focus();
  };

  return (
    <div
      data-slot="xlsx-viewer-tabs"
      role="tablist"
      aria-label="Workbook sheets"
      data-can-scroll-left={scrollState.canScrollLeft}
      data-can-scroll-right={scrollState.canScrollRight}
      data-overflowing={scrollState.isOverflowing}
      style={{ height: XLSX_SHEET_TABS_HEIGHT_PX }}
      className="bg-card relative flex-shrink-0 overflow-hidden border-t"
    >
      <div
        ref={scrollRef}
        data-slot="xlsx-viewer-tabs-scroll"
        className="h-full overflow-x-auto overflow-y-hidden overscroll-x-contain px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          ref={listRef}
          data-slot="xlsx-viewer-tabs-track"
          className="flex min-w-max items-stretch gap-0.5"
        >
          {sheets.map((sheet, sheetIndex) => (
            <button
              key={`${sheetIndex}:${sheet.name}`}
              ref={(element) => {
                tabRefs.current[sheetIndex] = element;
              }}
              type="button"
              role="tab"
              aria-selected={sheetIndex === activeSheetIndex}
              tabIndex={sheetIndex === activeSheetIndex ? 0 : -1}
              onClick={() => selectSheet(sheetIndex)}
              onKeyDown={(event) => onTabKeyDown(event, sheetIndex)}
              style={{
                height: TAB_HEIGHT_PX,
                ...(tabWidth ? { width: tabWidth } : null),
              }}
              title={sheet.name}
              data-active={sheetIndex === activeSheetIndex}
              className={cn(
                "relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-transparent px-2.5 text-xs leading-none font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] outline-none select-none",
                "focus-visible:ring-ring focus-visible:ring-offset-card focus-visible:ring-2 focus-visible:ring-offset-1",
                sheetIndex === activeSheetIndex
                  ? "border-border/70 bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span className="truncate">{sheet.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
