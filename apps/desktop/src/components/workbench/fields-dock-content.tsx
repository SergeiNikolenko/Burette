import { lazy, Suspense, useMemo } from "react";
import { useScientificDocument, sourceExtension } from "../../lib/workbench/source";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";

const FieldsPanel = lazy(() => import("./fields-panel").then(module => ({ default: module.FieldsPanel })));
const identities = new WeakMap<object, number>();
let serial = 0;
function identity(value: object) {
  let id = identities.get(value);
  if (id === undefined) { id = ++serial; identities.set(value, id); }
  return id;
}

/** A new source revision mounts a fresh panel, so no slice outlives the fields it was cut from. */
export function FieldsDockContent({ document, actions }: { document: ViewerDocument | null; actions: ShellActions }) {
  const { document: science, text } = useScientificDocument(document);
  const kind = document ? sourceExtension(document) : "";
  const source = useMemo(() => ({}), [document, science, text, kind]);
  if (!document || document.renderer !== "molstar" || !science?.grid || text === null) return null;
  return <Suspense fallback={null}><FieldsPanel key={identity(source)} document={document} actions={actions} science={science} sourceText={text} sourceKind={kind} /></Suspense>;
}
