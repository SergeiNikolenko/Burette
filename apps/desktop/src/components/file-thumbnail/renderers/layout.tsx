"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/** Centered, clipped white surface that hosts a rendered first unit. */
export function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-white">
      {children}
    </div>
  );
}

export function useElementWidth() {
  const [width, setWidth] = React.useState<number | null>(null);
  const ref = React.useCallback((el: HTMLElement | null) => {
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth) setWidth(nextWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

const GRID_COL_W = 46;

/** Internal-gridline table shared by the XLSX and CSV previews. */
export function GridTable({
  rows,
  headerRow,
}: {
  rows: string[][];
  headerRow?: boolean;
}) {
  const colCount = Math.max(1, ...rows.map((r) => r.length));
  return (
    <div className="absolute inset-0 overflow-hidden bg-white text-slate-700 dark:bg-slate-950 dark:text-slate-300">
      <table
        className="border-collapse leading-tight"
        style={{
          width: colCount * GRID_COL_W,
          tableLayout: "fixed",
          fontSize: 7,
        }}
      >
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {Array.from({ length: colCount }, (_, c) => (
                <td
                  key={c}
                  className={cn(
                    "truncate border-r border-b border-slate-200 px-1 py-0.5 last:border-r-0 dark:border-slate-800",
                    headerRow && r === 0
                      ? "bg-slate-50 font-semibold text-slate-900 dark:bg-slate-900/70 dark:text-slate-100"
                      : "text-slate-700 dark:text-slate-300",
                  )}
                >
                  {row[c] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders an HTML string into a fixed-size (square) sandboxed iframe and scales
 * it to the measured frame width, so the top of the page fills the tile. The
 * iframe is inert (no scripts, no pointer events).
 */
export function IframeDoc({ html }: { html: string }) {
  const { ref, width } = useElementWidth();

  const BASE = 820;
  const scale = width ? width / BASE : null;

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden bg-white">
      <iframe
        srcDoc={html}
        title=""
        sandbox=""
        scrolling="no"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none origin-top-left border-0"
        style={{
          width: BASE,
          height: BASE,
          transform: scale ? `scale(${scale})` : undefined,
          visibility: scale ? "visible" : "hidden",
        }}
      />
    </div>
  );
}
