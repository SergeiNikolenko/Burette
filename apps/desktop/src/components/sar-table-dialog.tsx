import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Spinner } from "./ui/spinner";
import { Structure } from "./rgroup-preview";
import { selectGridRows } from "../hooks/matched-pairs-source";
import { requestGridColumnText, requestGridColumnValues } from "../hooks/use-app-derived-columns";
import { buildSarTable, SAR_TABLE_MAX_GROUPS } from "../lib/sar-table";
import { activeViewerIframeForDocument } from "../lib/viewer-bridge";
import type { GridColumnChoice } from "./types";
import "./rgroup-analysis.css";
import "./sar-table.css";

export type SarTableRequest = {
  documentId: string;
  documentTitle: string;
  /** The R-position columns of the collection's R-group decomposition. */
  positions: GridColumnChoice[];
  seriesColumnId: string | null;
  /** The core each molecule was decomposed on, with its R positions as `[*:N]`. */
  coreColumnId: string | null;
  /** Numeric columns a cell can be coloured by. */
  columns: GridColumnChoice[];
};

type Preview = { name: string; smiles: string; svgUrl: string | null };
type CellAddress = { row: number; column: number };

const PREVIEWED_MOLECULES = 2;
const MAX_PREVIEW_BASE64_BYTES = 350_000;
const positionLabel = (column: GridColumnChoice) => column.label.replace(/^RGroup_/, "");
const sameCell = (a: CellAddress | null, b: CellAddress) => a?.row === b.row && a.column === b.column;

function Substituent({ smiles }: { smiles: string }) {
  // The decomposition writes an unsubstituted position as a hydrogen.
  if (/^\[H\]\[\*:\d+\]$/.test(smiles)) return <span className="sar-table-hydrogen">H</span>;
  return <Structure smiles={smiles.replace(/\[\*:\d+\]/g, "*")} width={84} height={48} />;
}

export function SarTableDialog({ request, onDismiss }: { request: SarTableRequest | null; onDismiss: () => void }) {
  const [text, setText] = useState<Map<string, Map<number, string>> | null>(null);
  const [error, setError] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [axes, setAxes] = useState<{ rows: string; columns: string } | null>(null);
  const [colourId, setColourId] = useState("");
  const [values, setValues] = useState<Map<number, number> | null>(null);
  const [hovered, setHovered] = useState<CellAddress | null>(null);
  const [pinned, setPinned] = useState<CellAddress | null>(null);
  const [previews, setPreviews] = useState<Map<number, Preview>>(new Map());

  useEffect(() => {
    setText(null); setError(""); setSeriesId(""); setAxes(null); setValues(null); setHovered(null); setPinned(null); setPreviews(new Map());
    setColourId(request?.columns[0]?.id ?? "");
    if (!request) return undefined;
    let current = true;
    void (async () => {
      try {
        const next = new Map<string, Map<number, string>>();
        for (const id of [...request.positions.map((column) => column.id), request.seriesColumnId, request.coreColumnId].filter((id): id is string => Boolean(id))) {
          next.set(id, await requestGridColumnText(request.documentId, id));
          if (!current) return;
        }
        setText(next);
      } catch (cause) {
        if (!current) return;
        console.error("[SAR table]", cause);
        setError("Could not read this collection. Reopen the SAR table to try again.");
      }
    })();
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; body?: Record<string, unknown> } | null;
      if (data?.source !== "burette-grid" || data.body?.type !== "chemicalSpaceMoleculePreview") return;
      const id = Number(data.body.sourceRecordId);
      if (data.body.sourceRecordId == null || !Number.isSafeInteger(id) || id < 0) return;
      const svg = typeof data.body.svgBase64 === "string" && data.body.svgBase64.length <= MAX_PREVIEW_BASE64_BYTES ? data.body.svgBase64 : "";
      const name = typeof data.body.name === "string" ? data.body.name : `Molecule ${id + 1}`;
      const smiles = typeof data.body.smiles === "string" ? data.body.smiles : "";
      setPreviews((known) => new Map(known).set(id, { name, smiles, svgUrl: svg ? `data:image/svg+xml;base64,${svg}` : null }));
    };
    window.addEventListener("message", onMessage);
    return () => {
      current = false;
      window.removeEventListener("message", onMessage);
      // The grid marks the molecule it was last asked about; leave it unmarked.
      activeViewerIframeForDocument(request.documentId, "grid2d")?.contentWindow?.postMessage({
        source: "burette-grid-host", body: { type: "chemicalSpaceHoverChanged", documentId: request.documentId, sourceRecordId: null },
      }, "*");
    };
  }, [request]);

  useEffect(() => {
    setValues(null);
    if (!request || !colourId) return undefined;
    let current = true;
    requestGridColumnValues(request.documentId, colourId).then(
      (next) => { if (current) setValues(next); },
      (cause) => { if (current) { console.error("[SAR table]", cause); setValues(new Map()); } },
    );
    return () => { current = false; };
  }, [request, colourId]);

  // Series, largest first; a collection decomposed on one core has one.
  const series = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of (request?.seriesColumnId && text?.get(request.seriesColumnId)?.values()) || []) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [request, text]);
  const activeSeries = series.some(([id]) => id === seriesId) ? seriesId : series[0]?.[0] ?? "";
  const members = useMemo(() => {
    const seriesText = request?.seriesColumnId ? text?.get(request.seriesColumnId) : undefined;
    return seriesText && activeSeries ? new Set([...seriesText].flatMap(([id, value]) => (value === activeSeries ? [id] : []))) : null;
  }, [request, text, activeSeries]);
  // Positions that vary in this series, the most varied first.
  const positions = useMemo(() => (request?.positions ?? []).flatMap((column) => {
    const groups = new Set([...(text?.get(column.id) ?? [])].flatMap(([id, value]) => (!members || members.has(id) ? [value] : [])));
    return groups.size ? [{ column, groups: groups.size }] : [];
  }).sort((a, b) => b.groups - a.groups), [request, text, members]);
  // The series' own core, as most of its molecules were decomposed on it.
  const core = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [id, smiles] of (request?.coreColumnId && text?.get(request.coreColumnId)) || []) {
      if (smiles && (!members || members.has(id))) counts.set(smiles, (counts.get(smiles) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [request, text, members]);
  const rowsId = positions.some(({ column }) => column.id === axes?.rows) ? axes!.rows : positions[0]?.column.id ?? "";
  const columnsId = positions.some(({ column }) => column.id === axes?.columns) && axes!.columns !== rowsId
    ? axes!.columns : positions.find(({ column }) => column.id !== rowsId)?.column.id ?? "";
  const table = useMemo(() => (text && rowsId && columnsId
    ? buildSarTable(text.get(rowsId) ?? new Map(), text.get(columnsId) ?? new Map(), values ?? new Map(), members)
    : null), [text, rowsId, columnsId, values, members]);

  const cellAt = (address: CellAddress | null) => (address && table?.cells[address.row]?.[address.column]) || null;
  const shown = cellAt(hovered) ?? cellAt(pinned);
  const shownIds = shown?.ids.slice(0, PREVIEWED_MOLECULES);
  // The grid answers one drawing at a time, so the next is asked for when the
  // previous one has arrived.
  const wanted = shownIds?.find((id) => !previews.has(id));
  useEffect(() => {
    if (!request || wanted === undefined) return;
    activeViewerIframeForDocument(request.documentId, "grid2d")?.contentWindow?.postMessage({
      source: "burette-grid-host", body: { type: "chemicalSpaceHoverChanged", documentId: request.documentId, sourceRecordId: wanted },
    }, "*");
  }, [request, wanted]);

  const choose = (next: Partial<{ rows: string; columns: string }>) => {
    setAxes({ rows: rowsId, columns: columnsId, ...next }); setHovered(null); setPinned(null);
  };
  const colour = request?.columns.find((column) => column.id === colourId);
  const shade = (mean: number) => (table && table.max > table.min ? (mean - table.min) / (table.max - table.min) : 0.5);
  const pinnedCell = cellAt(pinned);
  const selectInGrid = () => {
    if (!request || !pinnedCell) return;
    selectGridRows(request.documentId, pinnedCell.ids);
    onDismiss();
  };
  const axisSelect = (label: string, name: "rows" | "columns", value: string, other: string) =>
    <label className="flex min-w-0 flex-col gap-2 text-xs">{label}
      <NativeSelect name={name} value={value} onChange={(event) => choose({ [name]: event.target.value })}>
        {positions.filter(({ column }) => column.id !== other).map(({ column }) =>
          <NativeSelectOption key={column.id} value={column.id}>{positionLabel(column)}</NativeSelectOption>)}
      </NativeSelect>
    </label>;

  return <Dialog open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
    {/* A column whose only shrinking part is the table, so the core, the cell's molecules and Select in grid stay on screen. */}
    <DialogContent variant="form" size="xwide" className="flex min-w-0 flex-col overscroll-contain">
      <DialogHeader>
        <DialogTitle>SAR table</DialogTitle>
        <DialogDescription className="sr-only">The R-group decomposition of {request?.documentTitle} as a matrix of two positions, coloured by a column.</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 min-w-0 flex-col gap-4">
        {error && <p className="py-5 text-sm text-(--color-text-secondary)" role="alert">{error}</p>}
        {!error && !text && <p className="flex items-center justify-center gap-2 py-5 text-sm text-(--color-text-secondary)" role="status"><Spinner className="size-4" aria-hidden />Reading R-groups…</p>}
        {text && !table && <p className="py-5 text-sm text-(--color-text-secondary)" role="status">This series varies at fewer than two positions.</p>}
        {text && <div className="sar-table-head">
          {core && table && <figure className="sar-table-core"><Structure smiles={core} label={`Core ${core}`} attachments width={280} height={180} /></figure>}
          <div className="sar-table-controls">
          {series.length > 1 && <label className="flex min-w-0 flex-col gap-2 text-xs">Series
            <NativeSelect name="series" value={activeSeries} onChange={(event) => { setSeriesId(event.target.value); setAxes(null); setHovered(null); setPinned(null); }}>
              {series.map(([id, count]) => <NativeSelectOption key={id} value={id}>{id} ({count.toLocaleString()})</NativeSelectOption>)}
            </NativeSelect>
          </label>}
          {table && axisSelect("Rows", "rows", rowsId, columnsId)}
          {table && axisSelect("Columns", "columns", columnsId, rowsId)}
          {table && <label className="flex min-w-0 flex-col gap-2 text-xs">Colour by
            <NativeSelect name="colour" value={colourId} onChange={(event) => setColourId(event.target.value)}>
              {request?.columns.map((column) => <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>)}
            </NativeSelect>
          </label>}
          </div>
        </div>}
        {table && <div className="sar-table-scroll" onMouseLeave={() => setHovered(null)}>
          <table className="sar-table" aria-label={`${colour?.label ?? "Molecules"} by substituent`}>
            <thead>
              <tr>
                <th />
                {table.columnGroups.map((group) => <th key={group} scope="col" title={group}><Substituent smiles={group} /></th>)}
              </tr>
            </thead>
            <tbody>
              {table.rowGroups.map((group, row) => <tr key={group}>
                <th scope="row" title={group}><Substituent smiles={group} /></th>
                {table.cells[row].map((cell, column) => {
                  const address = { row, column };
                  if (!cell) return <td key={table.columnGroups[column]} />;
                  return <td key={table.columnGroups[column]} tabIndex={0} aria-selected={sameCell(pinned, address)}
                    style={cell.mean === null ? undefined : { "--sar-shade": `${Math.round(100 * shade(cell.mean))}%` } as CSSProperties}
                    data-strong={cell.mean !== null && shade(cell.mean) > 0.55 ? "" : undefined}
                    title={cell.ids.length > 1 ? `Mean of ${cell.valued} of ${cell.ids.length} molecules` : undefined}
                    onMouseEnter={() => setHovered(address)} onFocus={() => setHovered(address)}
                    onClick={() => setPinned(address)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPinned(address); } }}>
                    {cell.mean?.toFixed(2)}
                  </td>;
                })}
              </tr>)}
            </tbody>
          </table>
        </div>}
        {table && table.max > table.min && <div className="sar-table-legend" aria-label={`${colour?.label ?? "Value"} from ${table.min.toFixed(2)} to ${table.max.toFixed(2)}`}>
          <span>{colour?.label}</span><span className="tabular-nums">{table.min.toFixed(2)}</span><span className="sar-table-ramp" /><span className="tabular-nums">{table.max.toFixed(2)}</span>
        </div>}
        {/* The row is there before a cell is pointed at: a dialog that grew on hover would move the table under the pointer. */}
        {table && <div className="sar-table-molecules" aria-label="Molecules in the cell">
          {shown && shownIds?.map((id) => {
            const preview = previews.get(id);
            const value = values?.get(id);
            return <figure key={id}>
              {preview?.smiles ? <Structure smiles={preview.smiles} label={preview.name} width={290} height={160} />
                : preview?.svgUrl ? <img src={preview.svgUrl} alt="" /> : <div className="sar-table-molecule-pending" />}
              <figcaption><span className="truncate" title={preview?.name}>{preview?.name ?? `Molecule ${id + 1}`}</span>
                <span className="tabular-nums">{value === undefined ? "" : value.toFixed(2)}</span></figcaption>
            </figure>;
          })}
          {shown && shown.ids.length > PREVIEWED_MOLECULES && <span className="text-xs text-(--color-text-secondary)">+{shown.ids.length - PREVIEWED_MOLECULES}</span>}
        </div>}
        {table && (table.capped.rows || table.capped.columns) && <p className="text-xs text-(--color-text-secondary)" role="status">Showing the {SAR_TABLE_MAX_GROUPS} most frequent substituents.</p>}
      </div>
      {table && <DialogFooter>
        <Button type="button" disabled={!pinnedCell} onClick={selectInGrid}>Select in grid</Button>
      </DialogFooter>}
    </DialogContent>
  </Dialog>;
}
