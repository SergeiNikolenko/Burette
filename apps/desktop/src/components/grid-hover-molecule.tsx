import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { computeDerivedValue, computeRowProperties, loadDerivedEngines } from "../lib/derived-columns";
import { describePropValue } from "../lib/grid-value-stats.mjs";
import { writeClipboardText } from "../lib/clipboard";
import { postGridCommand } from "../lib/viewer-bridge";
import { scaffoldStatusLine, useSelectionScaffold } from "./grid-selection-scaffold";
import { showNativeContextMenu } from "./native-context-menu";
import { CloseIcon } from "./close-icon";
import type { GridFilterModel } from "./types";
import type { HoveredGridRow } from "../types";

const HEIGHT_STORAGE_KEY = "burette-grid-hover-molecule-height";
const HIDDEN_STORAGE_KEY = "burette-grid-hover-molecule-hidden";
const PROPS_HEIGHT_STORAGE_KEY = "burette-grid-hover-molecule-props-height";
const PROPS_OPEN_STORAGE_KEY = "burette-grid-hover-molecule-props-open";
// Putting the card away hands the job back to the map, which draws its own
// small preview next to the pointer. The map cannot see React state, so the
// card announces which of the two is currently showing the molecule.
export const HOVER_CARD_VISIBILITY_EVENT = "burette:hover-preview-card-visibility";

export function hoverPreviewCardHidden(): boolean {
  return window.localStorage.getItem(HIDDEN_STORAGE_KEY) === "1";
}

function announceCardVisibility(hidden: boolean) {
  window.dispatchEvent(new CustomEvent(HOVER_CARD_VISIBILITY_EVENT, { detail: { hidden } }));
}

const PROPS_MIN_HEIGHT = 56;
const PROPS_MAX_HEIGHT = 320;
const PROPS_DEFAULT_HEIGHT = 132;

// Numbers arrive as raw strings; long floats read badly in a tile, so they
// render with magnitude-aware precision (8.3010302 -> 8.301, 597.8316 -> 597.8).
function formatPropValue(value: string): string {
  const trimmed = value.trim();
  if (!/^-?\d+(?:\.\d+)?(?:e-?\d+)?$/iu.test(trimmed)) return trimmed;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return trimmed;
  if (Number.isInteger(numeric)) return numeric.toLocaleString();
  const magnitude = Math.abs(numeric);
  const decimals = magnitude >= 100 ? 1 : magnitude >= 10 ? 2 : 3;
  return numeric.toFixed(decimals).replace(/\.?0+$/u, "");
}

function storedPropsHeight(): number {
  const raw = Number(window.localStorage.getItem(PROPS_HEIGHT_STORAGE_KEY));
  return Number.isFinite(raw) && raw >= PROPS_MIN_HEIGHT && raw <= PROPS_MAX_HEIGHT ? raw : PROPS_DEFAULT_HEIGHT;
}
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 520;
const DEFAULT_HEIGHT = 210;
// Dragging the handle below this collapses the card entirely, so the preview
// can be put away with the same gesture that sizes it.
const COLLAPSE_HEIGHT = 72;
// Pointer travel that separates a pull on the strap from a plain click.
const DRAG_SLOP = 3;

function storedHeight(): number {
  const raw = Number(window.localStorage.getItem(HEIGHT_STORAGE_KEY));
  return Number.isFinite(raw) && raw >= MIN_HEIGHT && raw <= MAX_HEIGHT ? raw : DEFAULT_HEIGHT;
}

// DataWarrior keeps a full-size drawing of the current row in the corner of
// the window; this card is that surface for Burette. The grid posts the row
// under the pointer, and the card renders it with the in-process RDKit.
const svgCache = new Map<string, string>();
const specCache = new Map<string, string>();
const SVG_CACHE_LIMIT = 200;
// The drawing is asked for at the well's measured size, so it fills the space
// instead of being letterboxed inside it. Sizes round to this step so dragging
// the handle re-renders a handful of times rather than once per pixel.
const SVG_SIZE_STEP = 8;

function roundedSize(value: number, minimum: number): number {
  return Math.max(minimum, Math.round(value / SVG_SIZE_STEP) * SVG_SIZE_STEP);
}

// RDKit draws the carbon skeleton in black, which is invisible on the dark
// theme - the heteroatom labels showed and the molecule did not. Carbon takes
// the app's own ink colour instead, and nitrogen and oxygen are lightened just
// enough to stay legible against a dark surface. The light theme keeps RDKit's
// own palette, which is what it was designed for.
const DARK_STRUCTURE_PALETTE = {
  "6": [0.87, 0.87, 0.87],
  "7": [0.45, 0.62, 1],
  "8": [1, 0.45, 0.45],
};

function effectiveTheme(): string {
  return document.querySelector(".app-shell")?.getAttribute("data-effective-theme") ?? "light";
}

function structurePalette(theme: string) {
  return theme === "dark" ? DARK_STRUCTURE_PALETTE : undefined;
}

// The drawing paints its own paper instead of letting the well show through a
// transparent SVG: in the packaged runtime the well came out white, and a
// light-ink structure on white paper is a blank card. The paper is the colour
// the well is actually painted in, so the two meet without a seam in either
// theme and a custom theme background is followed without a second source of
// truth for it.
const DEFAULT_PAPER: Record<string, [number, number, number]> = {
  dark: [0.067, 0.067, 0.067],
  light: [1, 1, 1],
};

function paperColour(well: HTMLElement | null, theme: string): [number, number, number] {
  const surface = well ? window.getComputedStyle(well).backgroundColor : "";
  const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?\s*\)$/u.exec(surface);
  if (match && (match[4] === undefined || Number(match[4]) > 0)) {
    return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
  }
  return DEFAULT_PAPER[theme] ?? DEFAULT_PAPER.light;
}

// The shell publishes the resolved theme, so "auto" is already decided here.
function useEffectiveTheme(): string {
  const [theme, setTheme] = useState(effectiveTheme);
  useEffect(() => {
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    const observer = new MutationObserver(() => setTheme(effectiveTheme()));
    observer.observe(shell, { attributes: true, attributeFilter: ["data-effective-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

// Formula, weight and cLogP are what DataWarrior's detail view always shows
// next to the drawing, and they come from the same shared compute helpers the
// derived columns use - no second implementation of the chemistry.
function moleculeSpecLine(
  engines: Awaited<ReturnType<typeof loadDerivedEngines>>,
  row: { smiles?: string | null; molblock?: string | null },
): string {
  const parts: string[] = [];
  const formula = computeDerivedValue("formula", engines, row);
  if (formula.valueText) parts.push(formula.valueText);
  const properties = computeRowProperties(engines, row, ["MolWeight", "cLogP"]);
  const weight = properties.MolWeight?.valueReal;
  if (typeof weight === "number") parts.push(`${weight.toFixed(1)} Da`);
  const logP = properties.cLogP?.valueReal;
  if (typeof logP === "number") parts.push(`cLogP ${logP.toFixed(2)}`);
  return parts.join(" · ");
}

export function GridHoverMoleculeCard({
  row,
  filterModel,
  documentId,
}: {
  row: HoveredGridRow | null;
  filterModel?: GridFilterModel | null;
  documentId: string;
}) {
  // A lasso is answered on this surface rather than in a card of its own: the
  // fragment the selection shares takes the well until the pointer names a row
  // again, which is the moment the user asked about one molecule instead.
  const scaffold = useSelectionScaffold(documentId);
  const [scaffoldDismissed, setScaffoldDismissed] = useState(false);
  useEffect(() => {
    if (scaffold.kind !== "idle") setScaffoldDismissed(false);
  }, [scaffold]);
  useEffect(() => {
    if (row) setScaffoldDismissed(true);
  }, [row]);
  const showingScaffold = scaffold.kind !== "idle" && !scaffoldDismissed;

  const theme = useEffectiveTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [spec, setSpec] = useState("");
  // The well's real size, measured rather than assumed: the drawing is asked
  // for at these numbers so it fills the box at any drag height.
  const [wellSize, setWellSize] = useState<{ width: number; height: number } | null>(null);
  const wellObserverRef = useRef<ResizeObserver | null>(null);
  const wellNodeRef = useRef<HTMLDivElement | null>(null);
  const renderTokenRef = useRef(0);
  const lastRowRef = useRef<HoveredGridRow | null>(null);
  if (row) lastRowRef.current = row;
  // The card keeps showing the last hovered molecule after the pointer leaves
  // the grid - DataWarrior does the same, and a flickering empty card would
  // make the preview useless while moving between rows.
  const shown = row ?? lastRowRef.current;

  // A callback ref, not a mount effect: the card is unmounted while nothing is
  // hovered and while it is collapsed, so an effect with an empty dependency
  // list would run before the well exists and never attach.
  const attachWell = useCallback((node: HTMLDivElement | null) => {
    wellObserverRef.current?.disconnect();
    wellNodeRef.current = node;
    if (!node) {
      wellObserverRef.current = null;
      return;
    }
    // Measured here and now, not only from the observer: a ResizeObserver's
    // first callback needs a rendered frame, and a card that mounts while the
    // window is occluded or the dock is animating would otherwise sit on
    // "preview unavailable" until something happened to resize it.
    const initial = node.getBoundingClientRect();
    if (initial.width > 0 && initial.height > 0) {
      setWellSize({ width: roundedSize(initial.width, 120), height: roundedSize(initial.height, 80) });
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      setWellSize({ width: roundedSize(rect.width, 120), height: roundedSize(rect.height, 80) });
    });
    observer.observe(node);
    wellObserverRef.current = observer;
  }, []);

  useEffect(() => {
    const token = ++renderTokenRef.current;
    if (!wellSize) return;
    const scaffoldSource = showingScaffold && scaffold.kind === "found" ? scaffold.smiles : "";
    // The molblock is passed whole rather than trimmed: its first line is the
    // molecule name and is usually blank, and trimming shifts the header block.
    const rowMolblock = !scaffoldSource && (shown?.molblock ?? "").trim() ? shown?.molblock ?? "" : "";
    const source = scaffoldSource || rowMolblock || (shown?.smiles ?? "").trim();
    if (!source) {
      setSvg(null);
      setSpec("");
      return;
    }
    const paper = paperColour(wellNodeRef.current, theme);
    const sizedKey = `${theme} ${paper.join(",")} ${wellSize.width}x${wellSize.height} ${source}`;
    const cachedSvg = svgCache.get(sizedKey);
    const cachedSpec = specCache.get(source);
    if (cachedSvg !== undefined && cachedSpec !== undefined) {
      setSvg(cachedSvg);
      setSpec(cachedSpec);
      return;
    }
    void (async () => {
      try {
        const engines = await loadDerivedEngines();
        if (renderTokenRef.current !== token) return;
        const mol = engines.rdkit.get_mol(source);
        if (!mol) {
          if (renderTokenRef.current === token) {
            setSvg(null);
            setSpec("");
          }
          return;
        }
        try {
          const palette = structurePalette(theme);
          const rendered = mol.get_svg_with_highlights(JSON.stringify({
            width: wellSize.width,
            height: wellSize.height,
            backgroundColour: paper,
            padding: 0.04,
            ...(palette ? { atomColourPalette: palette } : {}),
          }));
          if (svgCache.size >= SVG_CACHE_LIMIT) svgCache.clear();
          svgCache.set(sizedKey, rendered);
          const specLine = cachedSpec ?? moleculeSpecLine(
            engines,
            rowMolblock ? { molblock: rowMolblock } : { smiles: source },
          );
          if (specCache.size >= SVG_CACHE_LIMIT) specCache.clear();
          specCache.set(source, specLine);
          if (renderTokenRef.current === token) {
            setSvg(rendered);
            setSpec(specLine);
          }
        } finally {
          mol.delete();
        }
      } catch {
        if (renderTokenRef.current === token) {
          setSvg(null);
          setSpec("");
        }
      }
    })();
  }, [scaffold, showingScaffold, shown, theme, wellSize]);

  const [hidden, setHidden] = useState(() => window.localStorage.getItem(HIDDEN_STORAGE_KEY) === "1");
  const collapse = useCallback(() => {
    setHidden(true);
    window.localStorage.setItem(HIDDEN_STORAGE_KEY, "1");
    announceCardVisibility(true);
  }, []);
  const restore = useCallback((nextHeight?: number) => {
    setHidden(false);
    window.localStorage.removeItem(HIDDEN_STORAGE_KEY);
    announceCardVisibility(false);
    if (nextHeight === undefined) return;
    const clamped = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, nextHeight)));
    setHeight(clamped);
    window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(clamped));
  }, []);

  // The strap left behind by a collapsed card: pull it up to bring the preview
  // back at the size you pull to, or click it to get the last size back.
  const strapRef = useRef<{ pointerY: number; pulled: boolean } | null>(null);
  const onStrapDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    strapRef.current = { pointerY: event.clientY, pulled: false };
  }, []);
  const onStrapMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const start = strapRef.current;
    if (!start) return;
    const pulled = start.pointerY - event.clientY;
    if (!start.pulled && pulled < DRAG_SLOP) return;
    start.pulled = true;
    restore(pulled);
  }, [restore]);
  const onStrapUp = useCallback(() => {
    const start = strapRef.current;
    strapRef.current = null;
    if (start && !start.pulled) restore();
  }, [restore]);

  // The drawing IS the row's structure, so acting on it acts on that row: the
  // grid runs the same command the Structure menu sends, aimed at the row under
  // the pointer instead of at the selection.
  const editInKetcher = useCallback(() => {
    if (!shown) return;
    postGridCommand(documentId, "structure.edit-in-ketcher", shown.index);
  }, [documentId, shown]);
  const showDrawingMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    if (!shown) return;
    const smiles = (shown.smiles ?? "").trim();
    void showNativeContextMenu([
      {
        kind: "item",
        id: "edit-in-ketcher",
        text: "Edit in Ketcher",
        detail: shown.name,
        action: editInKetcher,
      },
      { kind: "separator" },
      {
        kind: "item",
        id: "copy-smiles",
        text: "Copy SMILES",
        detail: smiles,
        disabled: !smiles,
        action: () => void writeClipboardText(smiles),
      },
    ], { x: event.clientX, y: event.clientY }, { forceWeb: true });
  }, [editInKetcher, shown]);

  const [propsOpen, setPropsOpen] = useState(() => window.localStorage.getItem(PROPS_OPEN_STORAGE_KEY) !== "0");
  const setPropsSectionOpen = useCallback((open: boolean) => {
    setPropsOpen(open);
    window.localStorage.setItem(PROPS_OPEN_STORAGE_KEY, open ? "1" : "0");
  }, []);

  const [height, setHeight] = useState(storedHeight);
  const resizeStateRef = useRef<{ pointerY: number; height: number } | null>(null);

  const onResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = { pointerY: event.clientY, height };
  }, [height]);

  const onResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStateRef.current;
    if (!start) return;
    // The card sits at the bottom, so dragging the handle UP grows it, and
    // pushing it past the bottom puts the card away.
    const raw = start.height + (start.pointerY - event.clientY);
    if (raw < COLLAPSE_HEIGHT) {
      resizeStateRef.current = null;
      collapse();
      return;
    }
    // Pulling past the tallest drawing has nowhere left to go, so the extra
    // travel opens the data section instead of dying against the clamp.
    if (raw > MAX_HEIGHT + DRAG_SLOP) setPropsSectionOpen(true);
    setHeight(Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, raw))));
  }, [collapse, setPropsSectionOpen]);

  const onResizeEnd = useCallback(() => {
    if (!resizeStateRef.current) return;
    resizeStateRef.current = null;
    setHeight((value) => {
      window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(value));
      return value;
    });
  }, []);

  // The filter panel already summarises every numeric column, so a value can be
  // placed in its column's spread without shipping the column to the host.
  const columnsByLabel = useMemo(() => {
    const lookup = new Map<string, { min?: number; max?: number; bins?: number[] }>();
    for (const column of filterModel?.columns ?? []) {
      if (column.type !== "number") continue;
      lookup.set(column.label.trim().toLowerCase(), column);
    }
    return lookup;
  }, [filterModel]);

  const [propsHeight, setPropsHeight] = useState(storedPropsHeight);
  const propsResizeRef = useRef<{ pointerY: number; height: number } | null>(null);
  const onPropsResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    propsResizeRef.current = { pointerY: event.clientY, height: propsHeight };
  }, [propsHeight]);
  const onPropsResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = propsResizeRef.current;
    if (!start) return;
    // The divider sits above the data table, so dragging it UP grows the table.
    const next = Math.min(PROPS_MAX_HEIGHT, Math.max(PROPS_MIN_HEIGHT, start.height + (start.pointerY - event.clientY)));
    setPropsHeight(next);
  }, []);
  const onPropsResizeEnd = useCallback(() => {
    if (!propsResizeRef.current) return;
    propsResizeRef.current = null;
    setPropsHeight((value) => {
      window.localStorage.setItem(PROPS_HEIGHT_STORAGE_KEY, String(value));
      return value;
    });
  }, []);

  // A lasso answer is reason enough to show the card even before anything has
  // been hovered.
  if (!shown && !showingScaffold) return null;
  const label = showingScaffold
    ? "Common scaffold"
    : shown?.name || `Molecule ${(shown?.index ?? 0) + 1}`;
  // A put-away card used to leave a bare strip of panel behind: the space it
  // freed read as a hole with nothing in it, and the handle that brings the
  // drawing back only appeared once the pointer happened to cross it. The
  // collapsed card is a bar that says whose structure is waiting instead.
  if (hidden) {
    return (
      <button
        type="button"
        className="grid-hover-molecule-strap"
        onPointerDown={onStrapDown}
        onPointerMove={onStrapMove}
        onPointerUp={onStrapUp}
        onPointerCancel={onStrapUp}
        aria-label="Show molecule preview"
        title="Click or pull up to show the molecule preview"
      >
        <span className="grid-hover-molecule-strap-grip" aria-hidden="true" />
        <span className="grid-hover-molecule-strap-label">{label}</span>
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" className="grid-hover-molecule-strap-chevron">
          <path d="M1.5 6.5 5 3l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }
  const scaffoldStatus = showingScaffold ? scaffoldStatusLine(scaffold) : null;
  const badge = showingScaffold
    ? (scaffold.kind === "failed" ? "" : `${scaffold.count} molecules`)
    : `row ${(shown?.index ?? 0) + 1}`;
  return (
    <section className="structure-brief-card grid-hover-molecule">
      <div
        className="resizable-handle resizable-handle-horizontal grid-hover-molecule-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize molecule preview"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={() => {
          setHeight(DEFAULT_HEIGHT);
          window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(DEFAULT_HEIGHT));
        }}
      >
        <span className="resizable-handle-grip" aria-hidden="true" />
      </div>
      <header className="grid-hover-molecule-header">
        <span className="grid-hover-molecule-name" title={label}>{label}</span>
        <span className="grid-hover-molecule-index">{badge}</span>
        <button
          type="button"
          className="grid-hover-molecule-close"
          onClick={collapse}
          aria-label="Hide molecule preview"
          title="Hide molecule preview"
        >
          <CloseIcon size={12} />
        </button>
      </header>
      <div
        ref={attachWell}
        className="grid-hover-molecule-svg"
        style={{ height }}
        role="button"
        tabIndex={0}
        title={`Edit ${label} in Ketcher`}
        onClick={editInKetcher}
        onContextMenu={showDrawingMenu}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          editInKetcher();
        }}
      >
        {scaffoldStatus ? (
          <span className="grid-hover-molecule-empty">{scaffoldStatus}</span>
        ) : svg ? (
          <div className="grid-hover-molecule-drawing" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span className="grid-hover-molecule-empty">Structure preview unavailable</span>
        )}
      </div>
      {showingScaffold ? (
        scaffold.kind === "found"
          ? <div className="grid-hover-molecule-spec" title={scaffold.smiles}>{scaffold.atoms} atoms · {scaffold.smiles}</div>
          : null
      ) : spec ? <div className="grid-hover-molecule-spec" title={spec}>{spec}</div> : null}
      {!showingScaffold && shown?.props?.length ? (
        <>
          <div className="grid-hover-molecule-props-bar">
            <span className="grid-hover-molecule-props-title">Data</span>
            <div
              className="resizable-handle resizable-handle-horizontal grid-hover-molecule-props-resize"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize data section"
              onPointerDown={onPropsResizeStart}
              onPointerMove={onPropsResizeMove}
              onPointerUp={onPropsResizeEnd}
              onPointerCancel={onPropsResizeEnd}
              onDoubleClick={() => {
                setPropsHeight(PROPS_DEFAULT_HEIGHT);
                window.localStorage.setItem(PROPS_HEIGHT_STORAGE_KEY, String(PROPS_DEFAULT_HEIGHT));
              }}
            >
              <span className="resizable-handle-grip" aria-hidden="true" />
            </div>
            <button
              type="button"
              className="grid-hover-molecule-props-toggle"
              aria-expanded={propsOpen}
              onClick={() => setPropsSectionOpen(!propsOpen)}
              title={propsOpen ? "Hide data" : "Show data"}
            >
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" style={{ transform: propsOpen ? "rotate(180deg)" : undefined }}>
                <path d="M1.5 6.5 5 3l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {propsOpen ? (
            <div className="grid-hover-molecule-props" style={{ maxHeight: propsHeight }}>
              {shown.props.map((entry) => {
                const described = describePropValue(entry.value, columnsByLabel.get(entry.label.trim().toLowerCase()));
                return (
                  <div
                    key={entry.label}
                    className="dock-metric grid-hover-molecule-prop"
                    data-tone={described.tone === "plain" ? undefined : described.tone}
                    title={described.detail ? `${entry.label}: ${entry.value}\n${described.detail}` : `${entry.label}: ${entry.value}`}
                  >
                    <span>{entry.label}</span>
                    <strong>
                      {formatPropValue(entry.value)}
                      {described.tone === "outlier-high" || described.tone === "outlier-low" ? (
                        <span className="grid-hover-molecule-prop-mark" aria-hidden="true">
                          {described.tone === "outlier-high" ? "\u25B2" : "\u25BC"}
                        </span>
                      ) : null}
                    </strong>
                    {described.position === null ? null : (
                      <span className="grid-hover-molecule-prop-track" aria-hidden="true">
                        <span style={{ left: `${(described.position * 100).toFixed(1)}%` }} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
