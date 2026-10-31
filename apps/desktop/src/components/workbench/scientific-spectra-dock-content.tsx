import { useSpectrumAtomSelection } from "../../hooks/use-spectrum-atom-selection";
import { lazy, Suspense } from "react";
import { useSceneSpectra } from "../../lib/workbench/scene-spectra";
import { useSpectraDisplayState } from "../../lib/workbench/spectra-display-state";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
const Panel = lazy(() => import("./scientific-spectra-panel").then(module => ({ default: module.ScientificSpectraPanel })));

/** File spectra and the exact scene frame remain separate choices, including a paired MCD source. */
export function ScientificSpectraDockContent({ document, actions }: { document: ViewerDocument | null; actions: Pick<ShellActions, "saveKetcherExportFile"> }) {
  const scene = useSceneSpectra(document);
  const selection = useSpectrumAtomSelection(document, scene);
  const display = useSpectraDisplayState(document, scene);
  if (!document || !scene || !display) return null;
  const { sources } = scene;
  if (!sources.length) return null;
  return <Suspense fallback={null}><Panel key={display.id} sources={sources} display={display.display} actions={actions} onSelectAtom={selection.selectAtom} />{selection.error ? <p role="alert" className="workbench-error">{selection.error}</p> : null}</Suspense>;
}
