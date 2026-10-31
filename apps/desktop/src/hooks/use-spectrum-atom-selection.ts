import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ScientificSpectra } from "../lib/molecular-workbench/scientific-spectra";
import type { StructureViewerAction } from "../lib/structure-composition";
import type { useSceneSpectra } from "../lib/workbench/scene-spectra";
import { scientificStateFor, subscribeImports } from "../lib/workbench/scientific-source-state";
import { captureLogicalSourceOwner, logicalSourceFor } from "../lib/science-session/state";
import { captureViewerActionTarget, requestViewerAction } from "../lib/viewer-bridge";
import { sha256Hex } from "../lib/source-editing/source-identity";
import { useSourceEditing } from "../lib/source-editing/context";
import type { ViewerDocument } from "../types";

type Scene = ReturnType<typeof useSceneSpectra>;
/** Digest the source before a gesture; never queue an old click behind hashing. */
export function useSpectrumAtomSelection(document: ViewerDocument | null, scene: Scene) {
  const editing = useSourceEditing(), logical = logicalSourceFor(document?.id);
  const revision = useSyncExternalStore(subscribeImports, () => document && scene?.text ? scientificStateFor(document.id, scene.text).revision : null);
  const key = useMemo(() => ({ document, science: scene?.science, text: scene?.text, index: scene?.index,
    frameIndex: scene?.nativeFrame?.frameIndex, frameCount: scene?.nativeFrame?.frameCount, logical, revision }),
  [document, scene?.science, scene?.text, scene?.index, scene?.nativeFrame?.frameIndex, scene?.nativeFrame?.frameCount, logical, revision]);
  const current = useRef(key), pending = useRef<AbortController | null>(null);
  const [ready, setReady] = useState<{ key: typeof key; sha: string } | null>(null);
  const [error, setError] = useState<{ key: typeof key; message: string } | null>(null);
  useLayoutEffect(() => { current.current = key; return () => { pending.current?.abort(); }; }, [key]);
  useEffect(() => {
    if (!key.text || key.frameIndex === undefined || key.frameCount === undefined) return;
    let active = true;
    void sha256Hex(key.text).then(sha => {
      if (active) setReady({ key, sha });
    }).catch(() => { if (active) setError({ key, message: "Cannot read this source for atom selection. Reopen the structure." }); });
    return () => { active = false; };
  }, [key]);
  const selectAtom = (data: ScientificSpectra, atomIndex: number) => {
    pending.current?.abort();
    if (!document || !scene || current.current !== key) return;
    setError(null);
    if (!scene.sources.some(source => source.data === data) || data.source.scope !== "frame"
      || data.source.frameIndex !== scene.index || data.source.frameCount !== scene.science.frames.length
      || !scene.nativeFrame) {
      setError({ key, message: "This spectrum has no atom mapping to the current structure." }); return;
    }
    if (ready?.key !== key) { setError({ key, message: "Wait for the source to load, then select the atom again." }); return; }
    const revision = key.revision;
    if (revision?.document !== scene.science || scientificStateFor(document.id, scene.text!).revision !== revision) { setError({ key, message: "The spectrum source changed. Reopen Spectra for the current source." }); return; }
    const operation = editing?.captureOperation(document), sourceCurrent = captureLogicalSourceOwner(document.id);
    const abort = new AbortController(); pending.current = abort;
    const unsubscribe = subscribeImports(() => { if (scientificStateFor(document.id, scene.text!).revision !== revision) abort.abort(); });
    const target = captureViewerActionTarget(document.id, () => !abort.signal.aborted && current.current === key && sourceCurrent() && (!operation || operation.isCurrent())
      && scientificStateFor(document.id, scene.text!).revision === revision);
    const action: StructureViewerAction = { type: "select_source_atom", sourceSha256: ready.sha, ...scene.nativeFrame,
      atomIndex, label: "Select spectrum atom", notify: false };
    void requestViewerAction(document.id, action, 15000, abort.signal, { target }).catch(error => {
      if (!abort.signal.aborted && current.current === key) setError({ key, message: error instanceof Error ? error.message : "Cannot select this atom in the current structure." });
    }).finally(() => { unsubscribe(); operation?.release(); });
  };
  return { selectAtom, error: error?.key === key ? error.message : null };
}
