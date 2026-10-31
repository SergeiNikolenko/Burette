import { lazy, Suspense, useMemo } from "react";
import { useScientificDocument, sourceExtension } from "../../lib/workbench/source";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";

const OrbitalsPanel = lazy(() => import("./orbitals-panel").then(module => ({ default: module.OrbitalsPanel })));
const identities = new WeakMap<object, number>();
let serial = 0;
function identity(value: object) {
  let id = identities.get(value);
  if (id === undefined) { id = ++serial; identities.set(value, id); }
  return id;
}

/** Scientific revisions and immutable document replacements own separate field jobs and surfaces. */
export function OrbitalsDockContent({ document, actions }: { document: ViewerDocument | null; actions: ShellActions }) {
  const { document: science, text } = useScientificDocument(document);
  const kind = document ? sourceExtension(document) : "";
  const source = useMemo(() => ({}), [document, science, text, kind]);
  if (!document || document.renderer !== "molstar" || !science || text === null || !(science.orbitals.length || science.grid)) return null;
  return <Suspense fallback={null}><OrbitalsPanel key={identity(source)} document={document} actions={actions} science={science} sourceText={text} sourceKind={kind} /></Suspense>;
}
