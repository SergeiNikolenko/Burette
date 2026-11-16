import { useSpectrumAtomSelection } from "../../hooks/use-spectrum-atom-selection";
import { lazy, Suspense, useEffect, useState } from "react";
import { McdCompanionPicker } from "./mcd-companion-picker";
import { useMcdCompanionTarget } from "../../lib/workbench/mcd-companion-tool";
import { scientificStateFor } from "../../lib/workbench/scientific-source-state";
import type { ScientificDocument } from "../../lib/molecular-workbench/scientific-types";
import { useSceneSpectra } from "../../lib/workbench/scene-spectra";
import { useSpectraDisplayState } from "../../lib/workbench/spectra-display-state";
import type { ViewerDocument } from "../../types";
import type { ShellActions } from "../types";
const Panel = lazy(() => import("./scientific-spectra-panel").then(module => ({ default: module.ScientificSpectraPanel })));

/** File spectra and the exact scene frame remain separate choices, including a paired MCD source. */
export function ScientificSpectraDockContent({ document, actions }: { document: ViewerDocument | null; actions: Pick<ShellActions, "saveKetcherExportFile"> }) {
  const scene = useSceneSpectra(document);
  const companion = useMcdCompanionTarget(document, scene);
  const [requestedSource, setRequestedSource] = useState<{ document: ViewerDocument; science: ScientificDocument; frameIndex: number; key: string } | null>(null);
  const selection = useSpectrumAtomSelection(document, scene);
  const display = useSpectraDisplayState(document, scene);
  useEffect(() => { setRequestedSource(current => current && (current.document !== document || current.science !== scene?.science || current.frameIndex !== scene?.index) ? null : current); }, [document, scene?.science, scene?.index]);
  if (!document || !scene || !display) return null;
  const { sources } = scene;
  if (!sources.length && !companion) return null;
  const wanted = requestedSource?.document === document && requestedSource.science === scene.science && requestedSource.frameIndex === scene.index && sources.some(source => source.key === requestedSource.key) ? requestedSource : null;
  const sourceSelection = wanted ? { key: wanted.key, onHandled: () => setRequestedSource(current => current === wanted ? null : current) } : undefined;
  return <><McdCompanionPicker target={companion} onAttached={target => {
    const science = scientificStateFor(target.document.id, target.sourceText).revision?.document;
    if (science) setRequestedSource({ document: target.document, science, frameIndex: target.sourceFrameIndex, key: `companion-${target.sourceFrameIndex}` });
  }} />{sources.length ? <Suspense fallback={null}><Panel key={display.id} sources={sources} display={display.display} actions={actions} onSelectAtom={selection.selectAtom} sourceSelection={sourceSelection} />{selection.error ? <p role="alert" className="workbench-error">{selection.error}</p> : null}</Suspense> : null}</>;

}
