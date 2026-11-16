import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "./ui/button";
import { requestContextualGuide } from "./onboarding/request";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { ArrowRight } from "./ui/app-icons";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Spinner } from "./ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Structure } from "./rgroup-preview";
import { readMatchedPairMolecules, selectGridRows } from "../hooks/matched-pairs-source";
import { requestGridColumnValues } from "../hooks/use-app-derived-columns";
import {
  MATCHED_PAIR_LIMITS,
  transformationStatistics,
  type MatchedPairsResult,
  type Transformation,
  type TransformationStatistics,
} from "../lib/matched-pairs/matched-pairs";
import { runMatchedPairs } from "../lib/matched-pairs/matched-pairs-task";
import type { GridColumnChoice } from "./types";
import "./rgroup-analysis.css";
import "./matched-pairs.css";

export type MatchedPairsRequest = {
  documentId: string;
  documentTitle: string;
  /** The collection's numeric columns, from the grid's catalog. */
  columns: GridColumnChoice[];
};

type Analysis = { result: MatchedPairsResult; names: Map<number, string>; smiles: Map<number, string>; total: number };
type Row = { key: string; transformation: Transformation; statistics: TransformationStatistics | null };

const SORTS = {
  pairs: "Most pairs",
  increase: "Largest increase",
  decrease: "Largest decrease",
} as const;
const TRANSFORMATIONS_PER_PAGE = 5;
const PAIRS_PER_PAGE = 2;

const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
const direction = (value: number) => (value > 0 ? "up" : value < 0 ? "down" : undefined);
// The attachment point reads as a plain asterisk in the drawing.
const drawn = (smiles: string) => smiles.replaceAll("[*:1]", "*");

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  if (total <= pageSize) return null;
  return <div className="rgroup-pagination">
    <Button type="button" variant="secondary" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
    <span className="text-xs tabular-nums" role="status">{(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, total).toLocaleString()} of {total.toLocaleString()}</span>
    <Button type="button" variant="secondary" size="sm" disabled={(page + 1) * pageSize >= total} onClick={() => onPage(page + 1)}>Next</Button>
  </div>;
}

export function MatchedPairsDialog({ request, onDismiss }: { request: MatchedPairsRequest | null; onDismiss: () => void }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [columnId, setColumnId] = useState("");
  const [values, setValues] = useState<Map<number, number> | null>(null);
  const [sort, setSort] = useState<keyof typeof SORTS>("pairs");
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState("");
  const [pairPage, setPairPage] = useState(0);

  useEffect(() => {
    setAnalysis(null); setProgress(null); setError(""); setValues(null);
    setColumnId(request?.columns[0]?.id ?? ""); setSort("pairs"); setPage(0); setSelectedKey(""); setPairPage(0);
    if (!request) return undefined;
    const abort = new AbortController();
    void (async () => {
      try {
        const source = await readMatchedPairMolecules(request.documentId);
        if (abort.signal.aborted) return;
        if (!source.molecules.length) { setError("The collection has no molecules."); return; }
        setProgress({ done: 0, total: Math.min(source.molecules.length, MATCHED_PAIR_LIMITS.molecules) });
        const result = await runMatchedPairs(source.molecules, { signal: abort.signal, onProgress: setProgress });
        setAnalysis({
          result,
          names: source.names,
          smiles: new Map(result.molecules.map(({ id, smiles }) => [id, smiles])),
          total: source.molecules.length,
        });
      } catch (cause) {
        if (abort.signal.aborted) return;
        console.error("[Matched pairs]", cause);
        setError("Could not analyse this collection. Reopen Matched pairs to try again.");
      } finally {
        if (!abort.signal.aborted) setProgress(null);
      }
    })();
    return () => abort.abort();
  }, [request]);

  useEffect(() => {
    setValues(null);
    if (!request || !columnId) return undefined;
    let current = true;
    requestGridColumnValues(request.documentId, columnId).then(
      (next) => { if (current) setValues(next); },
      (cause) => { if (current) { console.error("[Matched pairs]", cause); setValues(new Map()); } },
    );
    return () => { current = false; };
  }, [request, columnId]);

  const rows = useMemo<Row[]>(() => {
    if (!analysis) return [];
    const all = analysis.result.transformations.map((transformation) => ({
      key: `${transformation.from}>>${transformation.to}`,
      transformation,
      statistics: values ? transformationStatistics(transformation, values) : null,
    }));
    const mean = (row: Row, missing: number) => row.statistics?.mean ?? missing;
    return all.sort((a, b) => (sort === "increase" ? mean(b, -Infinity) - mean(a, -Infinity)
      : sort === "decrease" ? mean(a, Infinity) - mean(b, Infinity) : 0)
      || b.transformation.pairs.length - a.transformation.pairs.length
      || Math.abs(mean(b, 0)) - Math.abs(mean(a, 0))
      || a.key.localeCompare(b.key));
  }, [analysis, values, sort]);
  const selected = rows.find((row) => row.key === selectedKey) ?? null;
  const pageRows = rows.slice(page * TRANSFORMATIONS_PER_PAGE, (page + 1) * TRANSFORMATIONS_PER_PAGE);
  // Bars compare the rows on screen: one single-pair outlier elsewhere would flatten them all.
  const largestChange = pageRows.reduce((largest, row) => Math.max(largest, Math.abs(row.statistics?.mean ?? 0)), 0);
  const column = request?.columns.find((item) => item.id === columnId);
  const result = analysis?.result;
  const notes = analysis && result ? [
    result.capped.molecules && `Compared the first ${MATCHED_PAIR_LIMITS.molecules.toLocaleString()} of ${analysis.total > MATCHED_PAIR_LIMITS.molecules ? "more" : analysis.total.toLocaleString()} molecules.`,
    result.capped.fragmentations && `Compared the first ${result.molecules.length.toLocaleString()} molecules.`,
    result.capped.pairs && `Showing the first ${MATCHED_PAIR_LIMITS.pairs.toLocaleString()} pairs.`,
    result.skippedMolecules > 0 && `${result.skippedMolecules.toLocaleString()} ${result.skippedMolecules === 1 ? "molecule was" : "molecules were"} left out.`,
  ].filter(Boolean) : [];

  const select = (key: string) => { setSelectedKey(key); setPairPage(0); };
  const selectInGrid = () => {
    if (!request || !selected) return;
    selectGridRows(request.documentId, [...new Set(selected.transformation.pairs.flatMap(({ fromId, toId }) => [fromId, toId]))]);
    onDismiss();
  };
  const name = (id: number) => analysis?.names.get(id) || `Molecule ${id + 1}`;
  const value = (id: number) => { const number = values?.get(id); return number === undefined ? "" : number.toFixed(2); };
  const transformations = useRef<HTMLTableElement>(null);
  const found = Boolean(analysis) && rows.length > 0;
  useEffect(() => { if (found) requestContextualGuide("matched-pairs", transformations.current); }, [found]);

  return <Dialog open={request !== null} onOpenChange={(open) => { if (!open) onDismiss(); }}>
    <DialogContent variant="form" size="xwide" className="min-w-0 overscroll-contain">
      <DialogHeader>
        <DialogTitle>Matched pairs</DialogTitle>
        <DialogDescription className="sr-only">Transformations between molecules of {request?.documentTitle} that differ in one substituent, with the change in a column.</DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 flex-col gap-4">
        {error && <p className="py-5 text-sm text-(--color-text-secondary)" role="alert">{error}</p>}
        {!error && !analysis && <p className="flex items-center justify-center gap-2 py-5 text-sm text-(--color-text-secondary)" role="status">
          <Spinner className="size-4" aria-hidden />{progress && progress.total > 0
            ? `Comparing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} molecules…` : "Reading molecules…"}
        </p>}
        {analysis && rows.length === 0 && <p className="py-5 text-sm text-(--color-text-secondary)" role="status">No two molecules differ in a single substituent.</p>}
        {analysis && rows.length > 0 && <>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-2 text-xs">Property
              <NativeSelect name="property" value={columnId} onChange={(event) => setColumnId(event.target.value)}>
                {request?.columns.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.label}</NativeSelectOption>)}
              </NativeSelect>
            </label>
            <label className="flex min-w-0 flex-col gap-2 text-xs">Sort
              <NativeSelect name="sort" value={sort} onChange={(event) => { setSort(event.target.value as keyof typeof SORTS); setPage(0); }}>
                {Object.entries(SORTS).map(([id, label]) => <NativeSelectOption key={id} value={id}>{label}</NativeSelectOption>)}
              </NativeSelect>
            </label>
          </div>
          <Table ref={transformations} className="matched-pairs-table" aria-label="Transformations">
            <TableHeader>
              <TableRow>
                <TableHead>Replacement</TableHead>
                <TableHead className="text-right">Pairs</TableHead>
                <TableHead colSpan={2} className="text-right" title={`Mean change in ${column?.label ?? "the property"} after the replacement`}>Mean Δ</TableHead>
                <TableHead className="text-right" title="Standard deviation of the change">SD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map(({ key, transformation, statistics }) => {
                const pairs = transformation.pairs.length;
                return <TableRow key={key} tabIndex={0} className="cursor-default" aria-selected={key === selectedKey}
                  data-state={key === selectedKey ? "selected" : undefined}
                  aria-label={`${transformation.from} to ${transformation.to}, ${pairs} ${pairs === 1 ? "pair" : "pairs"}`}
                  onClick={() => select(key)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(key); } }}>
                  <TableCell><div className="matched-pairs-replacement">
                    <Structure smiles={drawn(transformation.from)} width={120} height={44} />
                    <ArrowRight className="size-4" aria-hidden />
                    <Structure smiles={drawn(transformation.to)} width={120} height={44} />
                  </div></TableCell>
                  <TableCell className="text-right tabular-nums">{pairs.toLocaleString()}</TableCell>
                  <TableCell className="matched-pairs-bar-cell" aria-hidden>{statistics && largestChange > 0 &&
                    <span className="matched-pairs-bar" data-direction={direction(statistics.mean)}
                      style={{ "--change": Math.abs(statistics.mean) / largestChange } as CSSProperties} />}</TableCell>
                  <TableCell className="matched-pairs-change text-right tabular-nums" data-direction={statistics ? direction(statistics.mean) : undefined}
                    title={statistics && statistics.count < pairs ? `${statistics.count} of ${pairs} pairs have a value` : undefined}>
                    {statistics ? signed(statistics.mean) : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{statistics?.sd == null ? "" : statistics.sd.toFixed(2)}</TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
          <Pager page={page} pageSize={TRANSFORMATIONS_PER_PAGE} total={rows.length} onPage={setPage} />
          {selected && <section className="matched-pairs-pairs" aria-label="Pairs">
            {selected.transformation.pairs.slice(pairPage * PAIRS_PER_PAGE, (pairPage + 1) * PAIRS_PER_PAGE).map(({ fromId, toId, constant }) => {
              const from = values?.get(fromId);
              const to = values?.get(toId);
              return <div key={`${fromId} ${toId} ${constant}`} className="matched-pairs-pair">
                {[fromId, toId].map((id, side) => <figure key={side}>
                  <Structure smiles={analysis.smiles.get(id) ?? ""} constant={result?.constants[constant]} width={264} height={140} />
                  <figcaption><span className="truncate" title={name(id)}>{name(id)}</span><span className="tabular-nums">{value(id)}</span></figcaption>
                </figure>)}
                <ArrowRight className="matched-pairs-arrow size-4" aria-hidden />
                <span className="matched-pairs-delta matched-pairs-change tabular-nums" data-direction={from === undefined || to === undefined ? undefined : direction(to - from)}>
                  {from === undefined || to === undefined ? "" : signed(to - from)}</span>
              </div>;
            })}
            <Pager page={pairPage} pageSize={PAIRS_PER_PAGE} total={selected.transformation.pairs.length} onPage={setPairPage} />
          </section>}
          {notes.length > 0 && <p className="text-xs text-(--color-text-secondary)" role="status"
            title="Molecules with several components, more than 100 heavy atoms or more than 10 rotatable bonds are not compared">{notes.join(" ")}</p>}
        </>}
      </div>
      {analysis && rows.length > 0 && <DialogFooter>
        <Button type="button" disabled={!selected} onClick={selectInGrid}>Select in grid</Button>
      </DialogFooter>}
    </DialogContent>
  </Dialog>;
}
