import { lazy, Suspense, useMemo } from "react";
import { sourceExtension, useScientificDocument } from "../../lib/workbench/source";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
const Panel = lazy(() => import("./plots-panel").then(module => ({ default: module.PlotsPanel })));
const identities = new WeakMap<object, number>(); let serial = 0;

/** Each source revision owns its atom selection and units; native frame events do not remount its charts. */
export function PlotsDockContent({ document, actions }: { document: ViewerDocument | null; actions: ShellActions }) {
  const { document: science, text } = useScientificDocument(document?.renderer === "molstar" ? document : null);
  const owner = useMemo(() => ({}), [document, science, text]);
  if (!document || !science || text === null || science.frames.length < 2) return null;
  const extension = sourceExtension(document);
  if (extension !== "xyz" && !(extension === "mol" && science.format === "cjson" && science.graph?.molfile === text)) return null;
  let id = identities.get(owner); if (id === undefined) { id = ++serial; identities.set(owner, id); }
  return <Suspense fallback={null}><Panel key={id} document={document} actions={actions} science={science} sourceText={text} /></Suspense>;
}
