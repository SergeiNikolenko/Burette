import { lazy, Suspense, useMemo } from "react";
import { useIndexedTrajectorySource } from "../../lib/workbench/indexed-trajectory-source";
import { useScientificPlots } from "../../lib/workbench/plots-tool";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
const Panel = lazy(() => import("./plots-panel").then(module => ({ default: module.PlotsPanel })));
const IndexedPanel = lazy(() => import("./indexed-plots-panel").then(module => ({ default: module.IndexedPlotsPanel })));
const identities = new WeakMap<object, number>(); let serial = 0;

/** Each source revision owns its atom selection and units; native frame events do not remount its charts. */
export function PlotsDockContent({ document, actions }: { document: ViewerDocument | null; actions: ShellActions }) {
  const { available: scientific, science, text } = useScientificPlots(document);
  const owner = useMemo(() => ({}), [document, science, text]);
  const { available: indexed } = useIndexedTrajectorySource(scientific ? null : document);
  if (!document) return null;
  // An indexed trajectory reads only the displayed frame; each opened source gets its own sample history.
  if (!scientific) return indexed ? <Suspense fallback={null}><IndexedPanel key={`${document.id}:${document.runtimePath}:${document.openClaimId ?? ""}`} document={document} actions={actions} /></Suspense> : null;
  if (!science || text === null) return null;
  let id = identities.get(owner); if (id === undefined) { id = ++serial; identities.set(owner, id); }
  return <Suspense fallback={null}><Panel key={id} document={document} actions={actions} science={science} sourceText={text} /></Suspense>;
}
