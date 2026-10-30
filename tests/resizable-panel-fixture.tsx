import { expect } from "bun:test";
import { Window } from "happy-dom";
import React, { act, createRef } from "react";

// HappyDOM has no flex layout or ResizeObserver delivery. These measurements
// exercise the real app panels and library listeners; run each suite separately.
export async function createResizableFixture(
  getWidth: () => number,
  getBehavior: () => "preserve-pixel-size" | "preserve-relative-size",
  options: { hiddenZero?: boolean; layoutEvents?: { layout: Record<string, number>; user: boolean }[] } = {},
) {
  const browser = new Window();
  for (const k of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "MutationObserver",
    "DOMRect",
    "KeyboardEvent",
  ] as const)
    Object.defineProperty(globalThis, k, {
      configurable: true,
      value: k === "window" ? browser : browser[k],
    });
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    getComputedStyle: browser.getComputedStyle.bind(browser),
  });
  const observers = new Set<RO>();
  class RO {
    targets = new Set<Element>();
    constructor(public callback: ResizeObserverCallback) {
      observers.add(this);
    }
    observe(el: Element) {
      this.targets.add(el);
    }
    unobserve(el: Element) {
      this.targets.delete(el);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
  }
  Object.assign(browser, { ResizeObserver: RO });
  Object.assign(globalThis, { ResizeObserver: RO });
  function size(el: HTMLElement): number {
    if (options.hiddenZero && getWidth() === 0) return 0;
    if (!el.hasAttribute("data-panel")) return getWidth();
    const panels = Array.from(el.parentElement!.children).filter((e) =>
      e.hasAttribute("data-panel"),
    ) as HTMLElement[];
    const fixed = panels.reduce(
      (s, e) =>
        s +
        (!parseFloat(e.style.flexGrow) && e.style.flexBasis.endsWith("px")
          ? parseFloat(e.style.flexBasis)
          : 0),
      0,
    );
    const total = panels.reduce((s, e) => s + (parseFloat(e.style.flexGrow) || 0), 0);
    return !parseFloat(el.style.flexGrow) && el.style.flexBasis.endsWith("px")
      ? parseFloat(el.style.flexBasis)
      : ((getWidth() - fixed) * (parseFloat(el.style.flexGrow) || 0)) / (total || 1);
  }
  Object.defineProperties(browser.HTMLElement.prototype, {
    offsetWidth: {
      get() {
        return size(this);
      },
    },
    offsetHeight: {
      get() {
        return 800;
      },
    },
    offsetLeft: {
      get() {
        return options.hiddenZero && getWidth() === 0 ? 0 : this.id === "right" ? getWidth() - size(this) : 0;
      },
    },
  });
  const { createRoot } = await import("react-dom/client");
  const { ResizablePanelGroup: Group, ResizablePanel: Panel, ResizableHandle: Separator } =
    await import("../apps/desktop/src/components/ui/resizable");
  const ref = createRef<import("react-resizable-panels").PanelImperativeHandle>();
  function Fixture({ bound }: { bound: number }) {
    return (
      <Group onLayoutChanged={options.layoutEvents ? (layout, meta) => options.layoutEvents!.push({ layout: { ...layout }, user: meta.isUserInteraction }) : undefined}>
        <Panel id="main" minSize="0px" />
        <Separator />
        <Panel
          id="right"
          panelRef={ref}
          defaultSize="360px"
          minSize={`${Math.min(260, bound * 0.25)}px`}
          maxSize={`${bound}px`}
          groupResizeBehavior={getBehavior()}
          collapsible
          collapsedSize="0px"
        />
      </Group>
    );
  }
  async function notify() {
    await act(async () => {
      for (const o of Array.from(observers))
        o.callback(
          Array.from(o.targets).map((target) => ({
            target,
            borderBoxSize: [{ inlineSize: getWidth(), blockSize: 800 }],
            contentBoxSize: [{ inlineSize: getWidth(), blockSize: 800 }],
            devicePixelContentBoxSize: [{ inlineSize: getWidth(), blockSize: 800 }],
            contentRect: new DOMRect(0, 0, getWidth(), 800),
          })),
          o as unknown as ResizeObserver,
        );
    });
  }
  function expectPixels(expected: number) {
    expect(ref.current!.getSize().inPixels).toBeCloseTo(expected, 1);
  }
  return { browser, size, createRoot, Group, Panel, Separator, ref, Fixture, notify, expectPixels };
}
