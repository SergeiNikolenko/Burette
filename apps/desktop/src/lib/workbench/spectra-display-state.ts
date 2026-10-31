import { useSyncExternalStore } from "react";
import type { AdditionalSpectrumKind } from "../molecular-workbench/scientific-spectra";
import type { SpectralPlotOptions } from "../molecular-workbench/scientific-spectra-plot";
import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import type { ViewerDocument } from "../../types";
import { logicalSourceFor, subscribeLogicalSources, type LogicalSource } from "../science-session/state";
import { hasScientificSource, scientificStateFor, subscribeImports, type ImportedRevision } from "./scientific-source-state";
import type { useSceneSpectra } from "./scene-spectra";

export type SpectrumDisplayState = { options: SpectralPlotOptions; showRaw: boolean; selected: string | null; page: number };
export type SourceDisplayState = { kind?: AdditionalSpectrumKind; element?: number; views: Map<string, SpectrumDisplayState> };
export type SpectraDisplayState = { source?: string; sources: Map<string, SourceDisplayState> };
type Entry = { id: number; valid: boolean; document: WeakRef<ViewerDocument>; science: WeakRef<ScientificDocument>;
  revision: WeakRef<ImportedRevision> | null; logical: WeakRef<LogicalSource> | null; hadScientificSource: boolean; display: SpectraDisplayState };
const entries = new Map<string, Entry>();
let nextIdentity = 0;
const LIMIT = 64;

// Keep only display choices. Weak ownership references do not retain a scientific
// payload after its source closes. Events revoke even an unmounted panel's ABA.
function invalidate() {
  for (const [key, entry] of entries) {
    const document = entry.document.deref(), revision = entry.revision?.deref(), logical = entry.logical?.deref();
    if (!document || !entry.science.deref() || (entry.logical && !logical)
      || logicalSourceFor(document.id) !== (logical ?? null)
      || (entry.revision ? !revision || scientificStateFor(document.id, revision.text).revision !== revision
        : hasScientificSource(document.id) !== entry.hadScientificSource)) {
      entry.valid = false; entries.delete(key);
    }
  }
}
subscribeImports(invalidate);
subscribeLogicalSources(invalidate);
const subscribe = (listener: () => void) => {
  const imports = subscribeImports(listener), logical = subscribeLogicalSources(listener);
  return () => { imports(); logical(); };
};

export function useSpectraDisplayState(document: ViewerDocument | null, scene: ReturnType<typeof useSceneSpectra>) {
  let entry: Entry | null = null;
  if (document && scene) {
    const key = `${document.id}\u0000${scene.index}`, logical = logicalSourceFor(document.id);
    const revision = scene.text ? scientificStateFor(document.id, scene.text).revision : null;
    const prior = entries.get(key);
    if (prior?.valid && prior.document.deref() === document && prior.science.deref() === scene.science
      && (prior.revision?.deref() ?? null) === revision && (prior.logical?.deref() ?? null) === logical) entry = prior;
    else {
      if (prior) prior.valid = false;
      entry = { id: ++nextIdentity, valid: true, document: new WeakRef(document), science: new WeakRef(scene.science),
        revision: revision ? new WeakRef(revision) : null, logical: logical ? new WeakRef(logical) : null,
        hadScientificSource: hasScientificSource(document.id), display: { sources: new Map() } };
    }
    entries.delete(key); entries.set(key, entry);
    while (entries.size > LIMIT) { const [oldest, old] = entries.entries().next().value!; old.valid = false; entries.delete(oldest); }
  }
  const valid = useSyncExternalStore(subscribe, () => entry?.valid ?? false);
  return valid ? entry : null;
}
