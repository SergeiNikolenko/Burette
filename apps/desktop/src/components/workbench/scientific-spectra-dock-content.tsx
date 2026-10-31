import { useSpectrumAtomSelection } from "../../hooks/use-spectrum-atom-selection";
import { lazy, Suspense } from "react";
import { useSceneSpectra } from "../../lib/workbench/scene-spectra";
import type { ScientificDocument } from "../../lib/molecular-workbench/scientific-types";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
const Panel = lazy(() => import("./scientific-spectra-panel").then(module => ({ default: module.ScientificSpectraPanel })));
const identities = new WeakMap<ScientificDocument, number>();
let nextIdentity = 0;

/** File spectra and the exact scene frame remain separate choices, including a paired MCD source. */
export function ScientificSpectraDockContent({ document, actions }: { document: ViewerDocument | null; actions: Pick<ShellActions, "saveKetcherExportFile"> }) {
  const scene = useSceneSpectra(document);
  const selection = useSpectrumAtomSelection(document, scene);
  if (!document || !scene) return null;
  const { science, index, sources } = scene;
  let identity = identities.get(science);
  if (identity === undefined) { identity = ++nextIdentity; identities.set(science, identity); }
  if (!sources.length) return null;
  return <Suspense fallback={null}><Panel key={`${document.id}:${identity}:${index}`} sources={sources} actions={actions} onSelectAtom={selection.selectAtom} />{selection.error ? <p role="alert" className="workbench-error">{selection.error}</p> : null}</Suspense>;
}
