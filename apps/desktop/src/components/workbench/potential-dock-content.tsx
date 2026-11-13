import { lazy, Suspense, useMemo } from "react";
import type { ScientificDocument } from "../../lib/molecular-workbench/scientific-types";
import { useStructureSourceText } from "../../lib/source-editing/use-structure-source-text";
import { POTENTIAL_GRAPH_FORMATS } from "../../lib/workbench/potential-tool";
import { useScientificDocument, sourceExtension } from "../../lib/workbench/source";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
import { useWorkbenchSource } from "./use-workbench-source";

const PotentialPanel = lazy(() => import("./potential-panel").then(module => ({ default: module.PotentialPanel })));

/**
 * A calculation's own document, or for a MOL or SDF file its atoms in source order, which the
 * scene binds like any atomic source. A new source revision mounts a fresh panel, as the Orbitals
 * dock does, so no surface outlives its source.
 */
export function PotentialDockContent({ document, actions }: { document: ViewerDocument | null; actions: ShellActions }) {
  const { document: calculation, text: calculationText } = useScientificDocument(document);
  const kind = document ? sourceExtension(document) : "";
  const graphOnly = !calculation && POTENTIAL_GRAPH_FORMATS.has(kind) ? document : null;
  // Gasteiger charges need a graph with bond orders; a Cube has none to read.
  const { source, structure } = useWorkbenchSource(calculation?.grid ? null : document, { graph: true });
  const { text: graphText } = useStructureSourceText(graphOnly);
  const fromGraph = useMemo<ScientificDocument | null>(() => graphOnly && source ? { format: "xyz", atoms: source.atoms, frames: [], modes: [], orbitals: [] } : null, [graphOnly, source]);
  const science = calculation ?? fromGraph, text = calculation ? calculationText : graphText;
  const key = useMemo(() => ({}), [document, science, text, kind]);
  if (!document || document.renderer !== "molstar" || !science?.atoms.length || text === null) return null;
  return <Suspense fallback={null}><PotentialPanel key={revision(key)} document={document} actions={actions} science={science} sourceText={text} sourceKind={kind} structure={structure} /></Suspense>;
}

const revisions = new WeakMap<object, number>();
let serial = 0;
function revision(value: object) {
  let id = revisions.get(value);
  if (id === undefined) { id = ++serial; revisions.set(value, id); }
  return id;
}
