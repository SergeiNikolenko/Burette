import DOMPurify from "dompurify";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { loadDerivedEngines } from "../lib/derived-columns";
import { DARK_STRUCTURE_PALETTE } from "../lib/structure-palette";
import { describePropValue } from "../lib/grid-value-stats.mjs";
import { writeClipboardText } from "../lib/clipboard";
import { postGridCommand } from "../lib/viewer-bridge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { scaffoldStatusLine, useSelectionScaffold } from "./grid-selection-scaffold";
import { showNativeContextMenu } from "./native-context-menu";
import { ShortcutTooltip } from "./shortcut-tooltip";
import type { GridFilterColumn, GridFilterModel } from "./types";
import type { HoveredGridRow } from "../types";

const GridMolecule3D = lazy(() => import("./grid-molecule-3d"));

const PROPS_HEIGHT_STORAGE_KEY = "burette-grid-hover-molecule-props-height";
const PROPS_OPEN_STORAGE_KEY = "burette-grid-hover-molecule-props-open";
const PREVIEW_HEIGHT_STORAGE_KEY = "burette-grid-hover-molecule-preview-height";
// Kept as a compatibility contract for the chemical-space panel. The inspector
// preview is now always the single hover surface, so it is never hidden.
export const HOVER_CARD_VISIBILITY_EVENT = "burette:hover-preview-card-visibility";

export function hoverPreviewCardHidden(): boolean {
  return false;
}

const PROPS_MIN_HEIGHT = 56;
const PROPS_DEFAULT_HEIGHT = 132;
const PREVIEW_MIN_HEIGHT = 160;
const PREVIEW_DEFAULT_HEIGHT = 260;
const PREVIEW_MAX_HEIGHT = 720;
const PREVIEW_RENDER_SCALE = 2;

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
  return Number.isFinite(raw) && raw >= PROPS_MIN_HEIGHT ? raw : PROPS_DEFAULT_HEIGHT;
}

function storedPreviewHeight(): number {
  const raw = Number(window.localStorage.getItem(PREVIEW_HEIGHT_STORAGE_KEY));
  return Number.isFinite(raw) && raw >= PREVIEW_MIN_HEIGHT
    ? Math.min(raw, PREVIEW_MAX_HEIGHT)
    : PREVIEW_DEFAULT_HEIGHT;
}

// DataWarrior keeps a full-size drawing of the current row in the corner of
// the window; this card is that surface for Burette. The grid posts the row
// under the pointer, and the card renders it with the in-process RDKit.
const svgCache = new Map<string, string>();
const SVG_CACHE_LIMIT = 200;
// The drawing is asked for at the well's measured size, so it fills the space
// instead of being letterboxed inside it. Sizes round to this step so dragging
// the handle re-renders a handful of times rather than once per pixel.
const SVG_SIZE_STEP = 8;
// A dock drag resizes the well every frame. The current SVG scales with the
// well meanwhile, and RDKit redraws once the size has held still this long:
// a 2x redraw per size step ran on the main thread and stalled the drag.
const SVG_RESIZE_SETTLE_MS = 160;

function roundedSize(value: number, minimum: number): number {
  return Math.max(minimum, Math.round(value / SVG_SIZE_STEP) * SVG_SIZE_STEP);
}

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

export function GridHoverMoleculeCard({
  row,
  filterModel,
  documentId,
  onInspectProperty,
}: {
  row: HoveredGridRow | null;
  filterModel?: GridFilterModel | null;
  documentId: string;
  onInspectProperty?: (columnId: string) => void;
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
  const [previewMode, setPreviewMode] = useState<"2d" | "3d">("2d");
  const [svg, setSvg] = useState<string | null>(null);
  const [invalidSource, setInvalidSource] = useState<string | null>(null);
  // The well's real size, measured rather than assumed: the drawing is asked
  // for at these numbers so it fills the box at any drag height.
  const [wellSize, setWellSize] = useState<{ width: number; height: number } | null>(null);
  const wellObserverRef = useRef<ResizeObserver | null>(null);
  const wellSettleTimerRef = useRef<number | undefined>(undefined);
  const wellNodeRef = useRef<HTMLDivElement | null>(null);
  const renderTokenRef = useRef(0);
  const lastRowRef = useRef<HoveredGridRow | null>(null);
  if (row) lastRowRef.current = row;
  // The card keeps showing the last hovered molecule after the pointer leaves
  // the grid - DataWarrior does the same, and a flickering empty card would
  // make the preview useless while moving between rows.
  const shown = row ?? lastRowRef.current;

  // The grid sends a 260px card SVG. Enlarging it also enlarges bond strokes,
  // so only use that artwork when the molecular source cannot be redrawn.
  const cardDrawing = useMemo(() => {
    if (showingScaffold || (shown?.molblock ?? "").trim() || (shown?.smiles ?? "").trim()) return null;
    const clean = DOMPurify.sanitize(shown?.cardRenderer === "rdkit" ? shown.previewSvg ?? "" : "", { USE_PROFILES: { svg: true } });
    return clean.trimStart().startsWith("<svg") ? clean : null;
  }, [showingScaffold, shown]);

  const molecularSource = showingScaffold && scaffold.kind === "found"
    ? scaffold.smiles
    : (shown?.molblock ?? "").trim() ? shown?.molblock ?? "" : (shown?.smiles ?? "").trim();
  const hideMolecularPreview = !showingScaffold && !cardDrawing && (!molecularSource || invalidSource === molecularSource);

  const [previewHeight, setPreviewHeight] = useState(storedPreviewHeight);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const previewResizeRef = useRef<{ pointerY: number; height: number } | null>(null);
  const previousPreviewHeight = useRef(previewHeight);
  const revealPreview = useCallback(() => {
    const card = cardRef.current;
    const preview = card?.querySelector<HTMLElement>(".grid-hover-molecule-svg, .grid-molecule-3d");
    const scroller = card?.closest<HTMLElement>(".dock-content");
    if (!preview || !scroller) return;
    const bounds = preview.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    const header = scroller.querySelector(".structure-inspector-header")?.getBoundingClientRect();
    const top = Math.max(viewport.top, header?.bottom ?? viewport.top);
    // Adjust only this dock, leaving the shell's clipped ancestors and the
    // horizontal scroll position alone. The file header is sticky.
    if (bounds.top < top) scroller.scrollTop += bounds.top - top;
    else if (bounds.bottom > viewport.bottom) {
      scroller.scrollTop += Math.min(bounds.top - top, bounds.bottom - viewport.bottom);
    }
  }, []);
  useLayoutEffect(() => {
    // Only an explicit handle/key resize changes this height. A scrolled
    // inspector can otherwise leave the now-small drawing above its viewport;
    // row, filter and property updates must preserve the user's scroll position.
    // Pointer drags reveal only on release so scrolling cannot pull the handle
    // away from the pointer while it is still moving.
    if (previewHeight < previousPreviewHeight.current && !previewResizeRef.current) {
      revealPreview();
    }
    previousPreviewHeight.current = previewHeight;
  }, [previewHeight, revealPreview]);
  const savePreviewHeight = useCallback((height: number) => {
    const next = Math.min(PREVIEW_MAX_HEIGHT, Math.max(PREVIEW_MIN_HEIGHT, height));
    setPreviewHeight(next);
    window.localStorage.setItem(PREVIEW_HEIGHT_STORAGE_KEY, String(next));
  }, []);
  const onPreviewResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewResizeRef.current = { pointerY: event.clientY, height: previewHeight };
  }, [previewHeight]);
  const onPreviewResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = previewResizeRef.current;
    if (!start) return;
    setPreviewHeight(Math.min(PREVIEW_MAX_HEIGHT, Math.max(PREVIEW_MIN_HEIGHT, start.height + event.clientY - start.pointerY)));
  }, []);
  const onPreviewResizeEnd = useCallback(() => {
    const start = previewResizeRef.current;
    if (!start) return;
    previewResizeRef.current = null;
    setPreviewHeight((height) => {
      window.localStorage.setItem(PREVIEW_HEIGHT_STORAGE_KEY, String(height));
      return height;
    });
    if (previewHeight < start.height) revealPreview();
  }, [previewHeight, revealPreview]);

  // A callback ref, not a mount effect: the card is unmounted while nothing is
  // hovered and while it is collapsed, so an effect with an empty dependency
  // list would run before the well exists and never attach.
  const attachWell = useCallback((node: HTMLDivElement | null) => {
    wellObserverRef.current?.disconnect();
    window.clearTimeout(wellSettleTimerRef.current);
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
      const next = { width: roundedSize(rect.width, 120), height: roundedSize(rect.height, 80) };
      window.clearTimeout(wellSettleTimerRef.current);
      wellSettleTimerRef.current = window.setTimeout(() => {
        setWellSize((current) => current?.width === next.width && current.height === next.height ? current : next);
      }, SVG_RESIZE_SETTLE_MS);
    });
    observer.observe(node);
    wellObserverRef.current = observer;
  }, []);

  useEffect(() => {
    const token = ++renderTokenRef.current;
    if (!wellSize || cardDrawing) return;
    const scaffoldSource = showingScaffold && scaffold.kind === "found" ? scaffold.smiles : "";
    // The molblock is passed whole rather than trimmed: its first line is the
    // molecule name and is usually blank, and trimming shifts the header block.
    const rowMolblock = !scaffoldSource && (shown?.molblock ?? "").trim() ? shown?.molblock ?? "" : "";
    const source = scaffoldSource || rowMolblock || (shown?.smiles ?? "").trim();
    if (!source) {
      setSvg(null);
      return;
    }
    const paper = paperColour(wellNodeRef.current, theme);
    let atoms = showingScaffold ? [] : shown?.highlightAtoms ?? [];
    let bonds = showingScaffold ? [] : shown?.highlightBonds ?? [];
    const showHydrogens = shown?.hydrogenDisplay === "all";
    const sizedKey = `${theme} ${paper.join(",")} ${wellSize.width}x${wellSize.height} ${shown?.useInputCoords === true} H:${showHydrogens} ${shown?.highlightSmarts ?? ""} ${atoms.join(",")} ${bonds.join(",")} ${source}`;
    const cachedSvg = svgCache.get(sizedKey);
    if (cachedSvg !== undefined) {
      setSvg(cachedSvg);
      return;
    }
    void (async () => {
      try {
        const engines = await loadDerivedEngines();
        if (renderTokenRef.current !== token) return;
        let mol;
        try { mol = engines.rdkit.get_mol(source); } catch { mol = null; }
        if (!mol || !mol.get_smiles()) {
          mol?.delete();
          if (renderTokenRef.current === token) {
            setSvg(null);
            setInvalidSource(source);
          }
          return;
        }
        try {
          if (showHydrogens) mol.add_hs_in_place();
          else {
            mol.remove_hs_in_place();
            // Removal can renumber atoms; repeat the grid's query on this copy.
            if (!showingScaffold && shown?.highlightSmarts) {
              const query = engines.rdkit.get_qmol(shown.highlightSmarts);
              try {
                const match = query ? JSON.parse(mol.get_substruct_match(query)) : {};
                atoms = match.atoms ?? [];
                bonds = match.bonds ?? [];
              } finally { query?.delete(); }
            }
          }
          if (showingScaffold || !shown?.useInputCoords) mol.set_new_coords();
          const palette = structurePalette(theme);
          const rendered = mol.get_svg_with_highlights(JSON.stringify({
            width: wellSize.width * PREVIEW_RENDER_SCALE,
            height: wellSize.height * PREVIEW_RENDER_SCALE,
            backgroundColour: paper,
            padding: 0.04,
            bondLineWidth: 2,
            atoms,
            bonds,
            ...(palette ? { atomColourPalette: palette } : {}),
          }));
          if (svgCache.size >= SVG_CACHE_LIMIT) svgCache.clear();
          svgCache.set(sizedKey, rendered);
          if (renderTokenRef.current === token) {
            setSvg(rendered);
          }
        } finally {
          mol.delete();
        }
      } catch {
        if (renderTokenRef.current === token) {
          setSvg(null);
        }
      }
    })();
    return () => { renderTokenRef.current += 1; };
  }, [scaffold, showingScaffold, shown, theme, wellSize, cardDrawing]);

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
    ], { x: event.clientX, y: event.clientY });
  }, [editInKetcher, shown]);

  const [propsOpen, setPropsOpen] = useState(() => window.localStorage.getItem(PROPS_OPEN_STORAGE_KEY) !== "0");
  const setPropsSectionOpen = useCallback((open: boolean) => {
    setPropsOpen(open);
    window.localStorage.setItem(PROPS_OPEN_STORAGE_KEY, open ? "1" : "0");
  }, []);

  // The filter panel already summarises every numeric column, so a value can be
  // placed in its column's spread without shipping the column to the host.
  const columnsByLabel = useMemo(() => {
    const lookup = new Map<string, GridFilterColumn>();
    for (const column of filterModel?.columns ?? []) {
      lookup.set(column.label.trim().toLowerCase(), column);
    }
    return lookup;
  }, [filterModel]);
  const columnsById = useMemo(() => new Map((filterModel?.columns ?? []).map((column) => [column.id, column])), [filterModel]);
  const visibleProps = useMemo(() => (shown?.props ?? []).flatMap((entry) => {
    const column = (entry.columnId ? columnsById.get(entry.columnId) : undefined)
      ?? columnsByLabel.get(entry.label.trim().toLowerCase());
    return column ? [{ entry, column }] : [];
  }), [columnsById, columnsByLabel, shown]);

  const [propsHeight, setPropsHeight] = useState(storedPropsHeight);
  const propsNodeRef = useRef<HTMLDivElement | null>(null);
  const propsResizeRef = useRef<{ pointerY: number; height: number; maxHeight: number } | null>(null);
  const savePropsHeight = useCallback((height: number) => {
    setPropsHeight(height);
    window.localStorage.setItem(PROPS_HEIGHT_STORAGE_KEY, String(height));
  }, []);
  const onPropsResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !propsNodeRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    propsResizeRef.current = {
      pointerY: event.clientY,
      height: propsNodeRef.current.getBoundingClientRect().height,
      maxHeight: Math.max(PROPS_MIN_HEIGHT, propsNodeRef.current.scrollHeight),
    };
  }, []);
  const onPropsResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = propsResizeRef.current;
    if (!start) return;
    // The bottom edge follows the pointer, up to the full content height.
    const next = Math.min(start.maxHeight, Math.max(PROPS_MIN_HEIGHT, start.height + event.clientY - start.pointerY));
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
  const scaffoldStatus = showingScaffold ? scaffoldStatusLine(scaffold) : null;
  const badge = showingScaffold
    ? (scaffold.kind === "failed" ? "" : `${scaffold.count} molecules`)
    : "";
  return (
    <Card ref={cardRef} size="sm" className="structure-brief-card grid-hover-molecule">
      <header className="grid-hover-molecule-header">
        <span className="grid-hover-molecule-name" title={label}>{label}</span>
        {!showingScaffold && !hideMolecularPreview && <div className="grid-preview-mode" role="group" aria-label="Molecule preview mode">
          {(["2d", "3d"] as const).map(mode => <Button key={mode} size="xs" variant={previewMode === mode ? "secondary" : "ghost"} aria-pressed={previewMode === mode} onClick={() => setPreviewMode(mode)}>{mode.toUpperCase()}</Button>)}
        </div>}
        {badge ? <span className="grid-hover-molecule-index">{badge}</span> : null}
      </header>
      {!hideMolecularPreview && (previewMode === "3d" && !showingScaffold ? <Suspense fallback={<div className="grid-molecule-3d" style={{ height: previewHeight }} />}>
        <GridMolecule3D key={documentId} hydrogenDisplay={shown?.hydrogenDisplay ?? "none"} molblock={shown?.molblock ?? ""} theme={theme} height={previewHeight} onOpen={() => { if (shown) postGridCommand(documentId, "structure.open-in-molstar", shown.index); }} />
      </Suspense> : <div
        ref={attachWell}
        className="grid-hover-molecule-svg"
        style={{ height: previewHeight }}
        role="button"
        tabIndex={0}
        aria-label={`Edit ${label}`}
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
        ) : cardDrawing ? (
          <div className="grid-hover-molecule-card-drawing" dangerouslySetInnerHTML={{ __html: cardDrawing }} />
        ) : svg ? (
          <div className="grid-hover-molecule-drawing" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span className="grid-hover-molecule-empty">Structure preview unavailable</span>
        )}
      </div>)}
      {!hideMolecularPreview ? <div
        className="resizable-handle resizable-handle-horizontal grid-hover-molecule-preview-resize"
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label="Resize molecule preview"
        aria-valuemin={PREVIEW_MIN_HEIGHT}
        aria-valuenow={previewHeight}
        aria-valuemax={PREVIEW_MAX_HEIGHT}
        aria-valuetext={`${Math.round(previewHeight)} pixels`}
        onPointerDown={onPreviewResizeStart}
        onPointerMove={onPreviewResizeMove}
        onPointerUp={onPreviewResizeEnd}
        onPointerCancel={onPreviewResizeEnd}
        onLostPointerCapture={onPreviewResizeEnd}
        onDoubleClick={() => savePreviewHeight(PREVIEW_DEFAULT_HEIGHT)}
        onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          savePreviewHeight(event.key === "Home" ? PREVIEW_MIN_HEIGHT
            : event.key === "End" ? PREVIEW_MAX_HEIGHT
            : previewHeight + (event.key === "ArrowDown" ? 32 : -32));
        }}
      ><span className="resizable-handle-grip" aria-hidden="true" /></div> : null}
      {!showingScaffold && visibleProps.length ? (
        <>
          <div className="grid-hover-molecule-props-bar">
            <span className="grid-hover-molecule-props-title">Data</span>
            {propsOpen ? (
              <button
                type="button"
                className="grid-hover-molecule-props-show-all"
                onClick={() => savePropsHeight(Math.max(PROPS_MIN_HEIGHT, propsNodeRef.current?.scrollHeight ?? PROPS_DEFAULT_HEIGHT))}
              >
                Show all
              </button>
            ) : null}
            <ShortcutTooltip label={propsOpen ? "Hide data" : "Show data"}>
              <button
                type="button"
                className="grid-hover-molecule-props-toggle"
                aria-expanded={propsOpen}
                aria-label={propsOpen ? "Hide data" : "Show data"}
                onClick={() => setPropsSectionOpen(!propsOpen)}
              >
                <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" style={{ transform: propsOpen ? "rotate(180deg)" : undefined }}>
                  <path d="M1.5 6.5 5 3l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </ShortcutTooltip>
          </div>
          {propsOpen ? (
            <>
              <div ref={propsNodeRef} className="grid-hover-molecule-props" style={{ maxHeight: propsHeight }}>
                {visibleProps.map(({ entry, column }) => {
                  const described = describePropValue(entry.value, column);
                  return (
                    <ShortcutTooltip key={entry.label} label={`${entry.label}: ${entry.value}`}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="dock-metric grid-hover-molecule-prop"
                        data-tone={described.tone === "plain" ? undefined : described.tone}
                        aria-label={`Open ${entry.label} filter`}
                        onClick={() => onInspectProperty?.(column.id)}
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
                      </Button>
                    </ShortcutTooltip>
                  );
                })}
              </div>
              <div
                className="resizable-handle resizable-handle-horizontal grid-hover-molecule-props-resize"
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize data section"
                aria-valuemin={PROPS_MIN_HEIGHT}
                aria-valuenow={propsHeight}
                aria-valuemax={Math.max(propsHeight, propsNodeRef.current?.scrollHeight ?? propsHeight)}
                aria-valuetext={`${Math.round(propsHeight)} pixels`}
                onPointerDown={onPropsResizeStart}
                onPointerMove={onPropsResizeMove}
                onPointerUp={onPropsResizeEnd}
                onPointerCancel={onPropsResizeEnd}
                onLostPointerCapture={onPropsResizeEnd}
                onDoubleClick={() => savePropsHeight(PROPS_DEFAULT_HEIGHT)}
                onKeyDown={(event) => {
                  const node = propsNodeRef.current;
                  if (!node || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const maxHeight = Math.max(PROPS_MIN_HEIGHT, node.scrollHeight);
                  const height = event.key === "Home" ? PROPS_MIN_HEIGHT
                    : event.key === "End" ? maxHeight
                    : node.getBoundingClientRect().height + (event.key === "ArrowDown" ? 32 : -32);
                  savePropsHeight(Math.min(maxHeight, Math.max(PROPS_MIN_HEIGHT, height)));
                }}
              >
                <span className="resizable-handle-grip" aria-hidden="true" />
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
