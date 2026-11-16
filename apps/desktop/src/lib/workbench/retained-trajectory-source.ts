import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ViewerDocument } from "../../types";
import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import type { StructureViewerAction } from "../structure-composition";
import { captureViewerActionTarget, requestViewerAction } from "../viewer-bridge";
import { captureLogicalSourceOwner } from "../science-session/state";
import { checkBindingReport } from "../science-session/scene-binding";
import { sha256Hex } from "../source-editing/source-identity";
import { useSourceEditing } from "../source-editing/context";
import { sourceExtension, useTrajectoryFrame } from "./source";

type Expected = NonNullable<Extract<StructureViewerAction, { type: "set_structure_pose" }>["expected"]>;

/** Scientific coordinate sets and rendered poses are different address spaces. */
export function useRetainedTrajectorySource(document: ViewerDocument, science: ScientificDocument, text: string) {
  const event = useTrajectoryFrame(document.id), editing = useSourceEditing();
  const extension = sourceExtension(document), graph = science.format === "cjson" ? science.graph : undefined;
  const lines = text.replace(/\r\n?/gu, "\n").trimEnd().split("\n");
  const final = extension === "xyz" && lines.length === Number(lines[0]) + 2;
  const supported = graph ? extension === "mol" && graph.molfile === text : extension === "xyz";
  const key = useMemo(() => ({ document, science, text, event, extension }), [document, science, text, event, extension]);
  const current = useRef(key);
  const [ready, setReady] = useState<{ key: typeof key; expected: Expected } | null>(null);
  const [error, setError] = useState<{ key: typeof key; message: string } | null>(null);
  useLayoutEffect(() => { current.current = key; }, [key]);
  useEffect(() => {
    if (!supported || graph || final || !event) return;
    const abort = new AbortController(), operation = editing?.captureOperation(document), logicalCurrent = captureLogicalSourceOwner(document.id);
    const target = captureViewerActionTarget(document.id, () => current.current === key && logicalCurrent() && (!operation || operation.isCurrent()));
    void Promise.all([sha256Hex(text), requestViewerAction(document.id, { type: "scene_science_binding", sourceExtension: "xyz" }, 10000, abort.signal, { target })]).then(([sha, value]) => {
      if (abort.signal.aborted || !target?.isCurrent()) return;
      const report = checkBindingReport(value);
      if (report.sourceSha256 !== sha || report.frameCount !== science.frames.length || report.frameCount !== event.frameCount || report.frameIndex !== event.frameIndex) return;
      setReady({ key, expected: { sourceExtension: "xyz", sourceSha256: sha, structureRef: report.structureRef, modelRef: report.modelRef,
        trajectoryRef: report.trajectoryRef, frameIndex: report.frameIndex, frameCount: report.frameCount } });
    }).catch(() => { /* A stale or foreign scene never enables a seek. */ });
    return () => { abort.abort(); operation?.release(); };
  }, [key, supported, graph, final, editing]);
  const binding = ready?.key === key ? ready.expected : null;
  const cursor = !supported ? null : graph ? graph.activeFrameIndex : final ? science.referenceFrameIndex ?? null : binding?.frameIndex ?? null;
  const seek = binding ? (index: number) => {
    const next = Math.max(0, Math.min(science.frames.length - 1, index));
    if (next === binding.frameIndex || current.current !== key) return;
    const operation = editing?.captureOperation(document), logicalCurrent = captureLogicalSourceOwner(document.id);
    const target = captureViewerActionTarget(document.id, () => current.current === key && logicalCurrent() && (!operation || operation.isCurrent()));
    setError(null);
    void requestViewerAction(document.id, { type: "set_structure_pose", label: `Frame ${next + 1}`, index: next, expected: binding }, 15000, undefined, { target })
      .catch(() => { if (current.current === key) setError({ key, message: "The trajectory changed. Select the current frame again." }); })
      .finally(() => operation?.release());
  } : undefined;
  return { cursor, seek, error: error?.key === key ? error.message : null };
}
