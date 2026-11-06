import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_POINT_GROUP_ATOMS, type PointGroupAtom, type PointGroupResult, type PointGroupTolerance } from "../../lib/molecular-workbench/symmetry/point-group";
import { runSymmetryTask } from "../../lib/molecular-workbench/symmetry/symmetry-client";
import type { MolecularAtom } from "../../lib/molecular-workbench/types";
import { parseXyz } from "../../lib/molecular-workbench/xyz";
import { structureEditAvailable } from "../../lib/workbench/graph-draft";
import {
  equivalenceRows, operationClasses, operationSymbol, pointGroupAtoms, schoenfliesParts, SYMMETRIZE_NO_OP_DISPLACEMENT, xyzWithPositions, type OperationSymbol,
} from "../../lib/workbench/molecular-symmetry";
import { chemistryError } from "../../lib/workbench/structure";
import { moleculeXyz } from "../../lib/workbench/symmetry-tools";
import { useTextDraft } from "../../lib/workbench/use-text-draft";
import { isAbortError } from "../../lib/viewer-errors";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { ArrowCurvedRight, Atom, Undo } from "../ui/app-icons";
import { Button } from "../ui/button";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { PanelEmptyState } from "../ui/panel-empty-state";
import { SegmentedControl, SegmentedControlItem } from "../ui/segmented-control";
import { Spinner } from "../ui/spinner";
import { IconAction } from "./geometry-fields";
import { useGraphDraft } from "./use-graph-draft";
import "./workbench-layout.css";
import "./crystal.css";

const TOLERANCES: { value: PointGroupTolerance; label: string }[] = [
  { value: "tight", label: "Tight" }, { value: "normal", label: "Normal" }, { value: "loose", label: "Loose" }, { value: "very-loose", label: "Very loose" },
];

function OperationGlyph({ symbol }: { symbol: OperationSymbol }) {
  return <>{symbol.base}{symbol.sub ? <sub>{symbol.sub}</sub> : null}{symbol.sup ? <sup>{symbol.sup}</sup> : null}{symbol.prime}</>;
}

function PointGroupSymbol({ symbol }: { symbol: string }) {
  const { base, sub } = schoenfliesParts(symbol);
  return <span className="workbench-point-group" aria-label={symbol}>{base}{sub ? <sub>{sub}</sub> : null}</span>;
}

type Outcome = { pointGroup: string; maxDisplacement: number; text: string };

/**
 * Molecular point group of an SDF, MOL or XYZ document at a chosen tolerance, and
 * Symmetrize as one Undo step of its own source. SDF and MOL share the Edit panel's
 * history; atoms keep their order, elements, charges and isotopes.
 */
export function SymmetryPanel({ document, actions }: { document: ViewerDocument | null; actions: ShellActions }) {
  const graphSource = structureEditAvailable(document);
  const graph = useGraphDraft(graphSource ? document : null);
  const xyz = useTextDraft<MolecularAtom[], "symmetrize">("point-group", graphSource ? null : document, graphSource ? null : {
    accepts: (text) => moleculeXyz(document, text),
    read: async (text) => parseXyz(text).atoms,
  }, "symmetry");
  const [tolerance, setTolerance] = useState<PointGroupTolerance>("normal");
  const [view, setView] = useState<"operations" | "atoms">("operations");
  const [selected, setSelected] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The analysed atoms of the current revision, with isotopes from the connection table.
  const snapshot = graph.history?.current ?? null;
  const revision = graphSource ? snapshot : xyz.history?.current ?? null;
  const text = graphSource ? snapshot?.text ?? null : xyz.history?.current.text ?? null;
  const atoms = useMemo<PointGroupAtom[] | null>(() => {
    try {
      if (graphSource) return snapshot ? pointGroupAtoms(snapshot.structure.atoms, snapshot.annotations.map(annotation => annotation.isotope)) : null;
      return xyz.history ? pointGroupAtoms(xyz.history.current.value) : null;
    } catch { return null; }
  }, [revision]);
  const tooLarge = Boolean(atoms && atoms.length > MAX_POINT_GROUP_ATOMS);
  const [detection, setDetection] = useState<{ atoms: PointGroupAtom[]; tolerance: PointGroupTolerance; result: PointGroupResult | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!atoms || tooLarge) return undefined;
    const controller = new AbortController();
    runSymmetryTask({ action: "detect-point-group", input: { atoms, tolerance } }, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setDetection({ atoms, tolerance, result, error: null }); })
      .catch((error) => { if (!controller.signal.aborted && !isAbortError(error)) setDetection({ atoms, tolerance, result: null, error: chemistryError(error) }); });
    return () => controller.abort();
  }, [atoms, tolerance]);
  const current = detection && detection.atoms === atoms && detection.tolerance === tolerance ? detection : null;
  const result = current?.result ?? null;
  const rows = useMemo(() => (result && atoms ? equivalenceRows(result.equivalenceSets, atoms) : []), [result, atoms]);
  const classes = useMemo(() => (result ? operationClasses(result.operations, result.pointGroup) : []), [result]);

  // The chosen equivalence set is highlighted in the scene; source atom indices are the viewer's.
  const chosen = selected === null ? null : rows.find((row) => row.index === selected) ?? null;
  const highlighted = chosen ? chosen.atoms.join(",") : "";
  const send = useRef(actions.runStructureViewerAction);
  send.current = actions.runStructureViewerAction;
  useEffect(() => {
    if (!highlighted || !document) return undefined;
    void send.current(document, { type: "preview_geometry", label: "Equivalent atoms", atoms: highlighted.split(",").map(Number), notify: false });
    return () => { void send.current(document, { type: "preview_geometry", label: "Equivalent atoms", atoms: [], notify: false }); };
  }, [highlighted]);

  if (graphSource ? !document : xyz.reading) return null;
  if (!document || (!graphSource && !xyz.available)) return <div className="dock-content dock-content-empty"><PanelEmptyState icon={<Atom />} title="No molecule selected" /></div>;

  const busy = graphSource ? graph.busy : xyz.busy;
  const running = busy ? "Symmetrizing" : null;
  const symmetrize = async () => {
    if (!atoms || !result) return;
    setFailure(null); setOutcome(null);
    const input = { atoms, tolerance };
    if (graphSource) {
      const from = graph.history?.current;
      if (!from) return;
      try {
        const symmetrized = await runSymmetryTask({ action: "symmetrize", input });
        if (!(symmetrized.maxDisplacement >= SYMMETRIZE_NO_OP_DISPLACEMENT)) { setOutcome({ pointGroup: symmetrized.pointGroup, maxDisplacement: 0, text: from.text }); return; }
        const next = await graph.apply({ kind: "positions", coordinates: symmetrized.coordinates, from });
        if (next) setOutcome({ pointGroup: symmetrized.pointGroup, maxDisplacement: symmetrized.maxDisplacement, text: "" });
      } catch (error) { if (!isAbortError(error)) setFailure(chemistryError(error)); }
      return;
    }
    let report: Outcome | null = null;
    await xyz.apply("symmetrize", async (revision, signal) => {
      const symmetrized = await runSymmetryTask({ action: "symmetrize", input }, { signal });
      report = { pointGroup: symmetrized.pointGroup, maxDisplacement: symmetrized.maxDisplacement, text: revision.text };
      return symmetrized.maxDisplacement >= SYMMETRIZE_NO_OP_DISPLACEMENT ? xyzWithPositions(revision.text, symmetrized.coordinates) : null;
    });
    if (report) setOutcome(report);
  };
  const history = graphSource ? graph.history : xyz.history;
  const undo = graphSource ? graph.undo : xyz.undo, redo = graphSource ? graph.redo : xyz.redo;
  const error = (graphSource ? graph.error : xyz.error) ?? current?.error ?? failure;
  const unchanged = outcome && outcome.maxDisplacement === 0 && outcome.text === text;
  const applied = outcome && outcome.maxDisplacement > 0 && history?.undo.length ? outcome : null;
  return (
    <div className="dock-content crystal-panel">
      <div className="workbench-toolbar">
        <IconAction label="Undo" disabled={busy || !history?.undo.length} onClick={() => { setOutcome(null); void undo(); }}><Undo aria-hidden /></IconAction>
        <IconAction label="Redo" disabled={busy || !history?.redo.length} onClick={() => { setOutcome(null); void redo(); }}><ArrowCurvedRight aria-hidden /></IconAction>
        {running ? <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />{running}</span>
          : atoms && !tooLarge && !current ? <span role="status" className="workbench-status"><Spinner aria-hidden className="size-3" />Finding point group</span> : null}
      </div>
      {tooLarge ? <p role="alert" className="workbench-error">{`Point groups are found for up to ${MAX_POINT_GROUP_ATOMS} atoms. This structure has ${atoms!.length.toLocaleString("en-US")}.`}</p> : (
        <label className="workbench-field">
          <span>Tolerance</span>
          {/* A list, as in Avogadro: four segments do not fit the narrowest dock. */}
          <NativeSelect aria-label="Tolerance" size="sm" value={tolerance} disabled={busy}
            onChange={(event) => { setTolerance(event.target.value as PointGroupTolerance); setOutcome(null); setSelected(null); }}>
            {TOLERANCES.map((item) => <NativeSelectOption key={item.value} value={item.value}>{item.label}</NativeSelectOption>)}
          </NativeSelect>
        </label>
      )}
      {error ? <p role="alert" className="workbench-error">{error}</p> : null}
      {result && atoms ? (
        <>
          <dl className="workbench-properties">
            <div><dt>Point group</dt><dd><PointGroupSymbol symbol={result.pointGroup} /></dd></div>
            <div><dt>Order</dt><dd>{result.order ?? "∞"}</dd></div>
            {classes.length ? (
              <div><dt>Classes</dt><dd>{classes.map((item, index) => (
                <span key={index}>{index ? ", " : ""}{item.count > 1 && result.order !== null ? item.count : ""}<OperationGlyph symbol={item.symbol} /></span>
              ))}</dd></div>
            ) : null}
          </dl>
          <div className="workbench-row">
            <Button type="button" size="xs" disabled={busy || !(graphSource ? graph.history : xyz.editable)} onClick={() => void symmetrize()}>Symmetrize</Button>
            {applied ? <span role="status" className="workbench-value">Symmetrized to <PointGroupSymbol symbol={applied.pointGroup} />, largest shift {applied.maxDisplacement.toFixed(4)} Å</span>
              : unchanged ? <span role="status" className="workbench-value">Already symmetric</span> : null}
          </div>
          {result.operations.length || rows.length ? (
            <>
              <SegmentedControl aria-label="Symmetry details" className="self-start" value={view} onValueChange={(value) => setView(value as typeof view)}>
                <SegmentedControlItem value="operations">Operations</SegmentedControlItem>
                <SegmentedControlItem value="atoms">Equivalent atoms</SegmentedControlItem>
              </SegmentedControl>
              <div className="crystal-sites">
                {view === "operations" ? (
                  <table className="workbench-table" aria-label="Symmetry operations">
                    <thead><tr><th scope="col">Operation</th><th scope="col">Axis or plane normal</th></tr></thead>
                    <tbody>
                      {result.operations.map((operation, index) => (
                        <tr key={index}><th scope="row"><OperationGlyph symbol={operationSymbol(operation, result.pointGroup)} /></th>
                          <td>{operation.axis ? operation.axis.map((value) => (Math.abs(value) < 5e-5 ? 0 : value).toFixed(4)).join(", ") : ""}</td></tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="workbench-table" aria-label="Equivalent atoms">
                    <thead><tr><th scope="col">Element</th><th scope="col" className="workbench-atom-list">Atoms</th><th scope="col">Count</th></tr></thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.index} data-selectable="" tabIndex={0} aria-selected={chosen?.index === row.index}
                          onClick={() => setSelected(chosen?.index === row.index ? null : row.index)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(chosen?.index === row.index ? null : row.index); } }}>
                          <th scope="row">{row.element}</th>
                          <td className="workbench-atom-list">{row.atoms.map((atom) => `${atoms[atom]?.element ?? "?"}${atom + 1}`).join(", ")}</td>
                          <td>{row.atoms.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
