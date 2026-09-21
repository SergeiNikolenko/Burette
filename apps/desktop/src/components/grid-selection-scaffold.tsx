import { useEffect, useRef, useState } from "react";

import { foldCommonScaffold, scaffoldMoleculesFromRows } from "../lib/common-scaffold.mjs";
import { fetchDerivedSourceRows, loadDerivedEngines } from "../lib/derived-columns";
import { isTauriRuntime } from "../lib/tauri";
import { requestGridRecords } from "../hooks/use-app-derived-columns";

const SCAFFOLD_ROW_BATCH = 500;

// The fold costs about a second and a half for a thousand molecules on a BACE
// set - the running query shrinks with every step, so it stays near linear.
// The cap is high enough that a lasso around a cluster is simply answered.
const MAX_SCAFFOLD_MOLECULES = 5_000;
// Below this a "common" fragment is just the molecule itself.
const MIN_SCAFFOLD_MOLECULES = 2;
// The strict intersection of a diverse selection collapses to a couple of atoms
// - a carbonyl that every organic molecule happens to carry is not a scaffold.
// Below this the card says the selection is too broad instead of drawing noise
// as if it were a finding.
const MEANINGFUL_SCAFFOLD_ATOMS = 6;
// The lasso fires while it is being drawn; only the settled selection is worth
// a scaffold search.
const SETTLE_DELAY_MS = 250;

type ScaffoldState =
  | { kind: "idle" }
  | { kind: "running"; count: number }
  | { kind: "empty"; count: number }
  | { kind: "capped"; count: number }
  | { kind: "trivial"; count: number; atoms: number }
  | { kind: "failed"; message: string }
  // Only the SMILES: the card draws it through the same measured-size pipeline
  // it uses for a hovered molecule, so the fragment fills the same well.
  | { kind: "found"; count: number; atoms: number; smiles: string };

type ScaffoldRow = { index: number; smiles?: string | null; molblock?: string | null };

// The lasso can pick anything in the collection, so the rows have to come from
// the whole of it. On the desktop that means the collection database, paged the
// way a derived column pages it - the grid's own record channel serves only the
// page it currently holds, which would silently drop every molecule the user
// scrolled past. Browser dev has no database and the grid is the source there.
async function fetchScaffoldRows(documentId: string): Promise<ScaffoldRow[]> {
  if (!isTauriRuntime()) return requestGridRecords(documentId);
  const rows: ScaffoldRow[] = [];
  let afterSourceIndex = -1;
  for (;;) {
    const batch = await fetchDerivedSourceRows(documentId, afterSourceIndex, SCAFFOLD_ROW_BATCH);
    if (batch.rows.length === 0) break;
    for (const row of batch.rows) {
      rows.push({ index: row.sourceIndex, smiles: row.smiles, molblock: row.molblock });
      afterSourceIndex = Math.max(afterSourceIndex, row.sourceIndex);
    }
    if (batch.rows.length < SCAFFOLD_ROW_BATCH) break;
  }
  return rows;
}

// One lasso after another over the same collection reuses the same rows.
const recordCache = new Map<string, Promise<ScaffoldRow[]>>();

function cachedRecords(documentId: string) {
  const cached = recordCache.get(documentId);
  if (cached) return cached;
  const pending = fetchScaffoldRows(documentId);
  recordCache.set(documentId, pending);
  void pending.catch(() => recordCache.delete(documentId));
  return pending;
}

export function invalidateScaffoldRecords(documentId: string) {
  recordCache.delete(documentId);
}

export type { ScaffoldState };

// Not a card of its own: the answer belongs on the structure surface the user
// is already looking at, so the preview card in the corner shows it there.
export function useSelectionScaffold(documentId: string): ScaffoldState {
  const [state, setState] = useState<ScaffoldState>({ kind: "idle" });
  const tokenRef = useRef(0);

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId?: string; sourceRecordIds?: number[] }>).detail;
      if (String(detail?.documentId || "") !== documentId) return;
      const selection = Array.isArray(detail?.sourceRecordIds) ? detail.sourceRecordIds : [];
      const token = ++tokenRef.current;
      if (selection.length < MIN_SCAFFOLD_MOLECULES) {
        setState({ kind: "idle" });
        return;
      }
      if (selection.length > MAX_SCAFFOLD_MOLECULES) {
        setState({ kind: "capped", count: selection.length });
        return;
      }
      setState({ kind: "running", count: selection.length });
      const timer = window.setTimeout(() => {
        void (async () => {
          try {
            const [engines, records] = await Promise.all([
              loadDerivedEngines(),
              cachedRecords(documentId),
            ]);
            if (tokenRef.current !== token) return;
            const wanted = new Set(selection);
            const molecules = scaffoldMoleculesFromRows(
              engines.ocl,
              records.filter((record) => wanted.has(record.index)),
            );
            if (molecules.length < MIN_SCAFFOLD_MOLECULES) {
              if (tokenRef.current === token) setState({ kind: "empty", count: selection.length });
              return;
            }
            // The webview paints between chunks; a 200-molecule fold in one go
            // is a visible freeze.
            let common = molecules[0];
            for (let start = 1; start < molecules.length; start += 20) {
              await new Promise((resolve) => window.setTimeout(resolve, 0));
              if (tokenRef.current !== token) return;
              const next = foldCommonScaffold(
                engines.ocl,
                [common, ...molecules.slice(start, start + 20)],
              );
              if (!next) {
                if (tokenRef.current === token) setState({ kind: "empty", count: molecules.length });
                return;
              }
              common = next;
            }
            const smiles = common.toSmiles();
            const atoms = common.getAllAtoms();
            if (atoms < MEANINGFUL_SCAFFOLD_ATOMS) {
              if (tokenRef.current === token) setState({ kind: "trivial", count: molecules.length, atoms });
              return;
            }
            if (tokenRef.current !== token) return;
            setState({ kind: "found", count: molecules.length, atoms, smiles });
          } catch (error) {
            if (tokenRef.current !== token) return;
            setState({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
          }
        })();
      }, SETTLE_DELAY_MS);
      return () => window.clearTimeout(timer);
    };
    window.addEventListener("burette:chemical-space-selection", handle);
    return () => window.removeEventListener("burette:chemical-space-selection", handle);
  }, [documentId]);

  return state;
}

// What the card says while the search is anything other than a drawn fragment.
export function scaffoldStatusLine(state: ScaffoldState): string | null {
  switch (state.kind) {
    case "running":
      return "Finding the fragment they all share…";
    case "capped":
      return `Select at most ${MAX_SCAFFOLD_MOLECULES.toLocaleString()} molecules to search for a shared fragment.`;
    case "empty":
      return "These molecules share no common fragment.";
    case "trivial":
      return `Only ${state.atoms} atoms are shared by all of them — too broad a selection for a scaffold.`;
    case "failed":
      return state.message;
    default:
      return null;
  }
}
