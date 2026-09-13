import { useEffect, useMemo, useState } from "react";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { activeViewerIframeForDocument, isKnownViewerMessageSource } from "../lib/viewer-bridge";
import type { ViewerDocument } from "../types";

type Column = { id: string; label: string };
type Props = {
  document: ViewerDocument;
  columns: (id: string, signal: AbortSignal) => Promise<Column[]>;
  values: (id: string, column: string, signal: AbortSignal) => Promise<Array<[number, number]>>;
};

// A property plot reads existing numeric columns. It never starts an embedding
// or scientific calculation, and selections use the same Grid/inspector bridge.
export function ChemicalPropertyPlot({ document: source, columns: readColumns, values: readValues }: Props) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [axes, setAxes] = useState<[string, string]>(["", ""]);
  const [points, setPoints] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const post = (body: Record<string, unknown>) => activeViewerIframeForDocument(source.id, "grid2d")?.contentWindow?.postMessage({ source: "burette-grid-host", body: { ...body, documentId: source.id } }, "*");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setPoints([]); setPreview(null); setSelected(null);
    readColumns(source.id, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setColumns(result);
      setAxes(current => {
        const x = result.find(c => /molecular.?weight|mol.?wt|^mw$/i.test(c.label))?.id || result[0]?.id || "";
        const y = result.find(c => /slogp|logp/i.test(c.label))?.id || result[1]?.id || x;
        return current.every(id => result.some(c => c.id === id)) ? current : [x, y];
      });
      if (result.length < 2) { setError("Add two numeric property columns to plot this collection."); setLoading(false); }
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [source.id, revision, readColumns]);
  useEffect(() => {
    if (!axes[0] || !axes[1]) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setPoints([]);
    Promise.all(axes.map(id => readValues(source.id, id, controller.signal))).then(([xs, ys]) => {
      if (controller.signal.aborted) return;
      const y = new Map(ys);
      setPoints(xs.filter(([id, x]) => Number.isFinite(x) && Number.isFinite(y.get(id))).map(([id, x]) => ({ id, x, y: y.get(id)! })));
      setLoading(false);
    }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [source.id, axes, revision, readValues]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const body = event.data?.body;
      if (event.data?.source !== "burette-grid" || body?.documentId !== source.id || !isKnownViewerMessageSource(event.source, source.id)) return;
      if (body.type === "chemicalSpaceMoleculePreview" && body.sourceRecordId === selected && typeof body.svgBase64 === "string" && body.svgBase64.length < 1_000_000) {
        setPreview({ name: String(body.name || `Molecule ${selected! + 1}`).slice(0, 160), url: `data:image/svg+xml;base64,${body.svgBase64}` });
      }
      if (body.type === "gridSourceChanged") setRevision(value => value + 1);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [source.id, selected]);
  const bounds = useMemo(() => {
    const range = (key: "x" | "y") => {
      let min = Infinity, max = -Infinity;
      for (const point of points) { min = Math.min(min, point[key]); max = Math.max(max, point[key]); }
      if (!Number.isFinite(min)) return [0, 1];
      const pad = (max - min || Math.max(1, Math.abs(min) * 0.1)) * 0.08;
      return [min - pad, max + pad];
    };
    return { x: range("x"), y: range("y") };
  }, [points]);
  const choose = (id: number) => {
    setSelected(id); setPreview(null);
    post({ type: "chemicalSpaceSelectionChanged", sourceRecordIds: [id], focusSourceRecordId: id, filterToSelection: false });
    post({ type: "chemicalSpaceHoverChanged", sourceRecordId: id });
    window.dispatchEvent(new CustomEvent("burette:chemical-space-selection", { detail: { documentId: source.id, sourceRecordIds: [id] } }));
  };
  const label = (axis: number) => columns.find(c => c.id === axes[axis])?.label || "Property";
  const shown = points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 2000)) === 0);
  return <div className="flex h-full min-h-0 flex-col gap-2 p-3" data-testid="chemical-property-plot">
    <div className="flex flex-wrap items-center gap-2">
      {([0, 1] as const).map(axis => <label key={axis} className="flex items-center gap-2 text-xs text-muted-foreground">{axis === 0 ? "X" : "Y"}
        <NativeSelect aria-label={axis === 0 ? "X property" : "Y property"} size="sm" value={axes[axis]} onChange={event => setAxes(current => axis === 0 ? [event.target.value, current[1]] : [current[0], event.target.value])}>
          {columns.map(column => <NativeSelectOption key={column.id} value={column.id}>{column.label}</NativeSelectOption>)}
        </NativeSelect>
      </label>)}
      <span className="ml-auto text-xs text-muted-foreground">{shown.length < points.length ? `${shown.length} of ` : ""}{points.length.toLocaleString()} molecules</span>
    </div>
    {loading || error || !points.length ? <p role="status" className="m-auto text-sm text-muted-foreground">{loading ? "Reading molecular properties…" : error || "These columns have no matching numeric values."}</p> :
      <div className="flex min-h-0 flex-1 gap-3">
        <svg viewBox="0 0 620 340" className="min-w-0 flex-1" role="group" aria-label={`${label(0)} against ${label(1)}`}>
          {[0, 1, 2, 3, 4].map(i => <g key={i}>
            <line x1="64" x2="602" y1={20 + i * 66} y2={20 + i * 66} stroke="currentColor" opacity=".12" />
            <text x="54" y={24 + i * 66} textAnchor="end" fontSize="10" fill="currentColor" opacity=".65">{(bounds.y[1] - (bounds.y[1] - bounds.y[0]) * i / 4).toFixed(1)}</text>
            <text x={64 + i * 134.5} y="304" textAnchor="middle" fontSize="10" fill="currentColor" opacity=".65">{(bounds.x[0] + (bounds.x[1] - bounds.x[0]) * i / 4).toFixed(1)}</text>
          </g>)}
          {shown.map(point => <circle key={point.id} data-property-point={point.id} role="button" tabIndex={0} aria-label={`Inspect molecule ${point.id + 1}`} aria-pressed={selected === point.id}
            cx={64 + (point.x - bounds.x[0]) / (bounds.x[1] - bounds.x[0]) * 538} cy={284 - (point.y - bounds.y[0]) / (bounds.y[1] - bounds.y[0]) * 264}
            r={selected === point.id ? 6 : points.length > 500 ? 2.5 : 4.5} fill={selected === point.id ? "#98ccf5" : "#659cc8"} fillOpacity={selected === point.id ? 1 : .65}
            stroke={selected === point.id ? "#d3eaff" : "transparent"} strokeWidth="1.5" className="cursor-pointer focus:outline-2 focus:outline-primary" onClick={() => choose(point.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(point.id); } }} />)}
          <text x="333" y="330" textAnchor="middle" fill="currentColor" fontSize="11">{label(0)}</text>
          <text transform="translate(14 152) rotate(-90)" textAnchor="middle" fill="currentColor" fontSize="11">{label(1)}</text>
        </svg>
        {preview && <figure className="flex w-1/4 min-w-24 max-w-48 flex-col justify-center gap-2">
          <img src={preview.url} alt={preview.name} className="aspect-square w-full rounded-lg bg-white object-contain" />
          <figcaption className="truncate text-xs text-muted-foreground">{preview.name}</figcaption>
        </figure>}
      </div>}
  </div>;
}
