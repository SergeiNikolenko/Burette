import { useMemo } from "react";
import type { ViewerDocument } from "../../types";
import { useSourceEditing } from "../source-editing/context";
import { useLogicalSource, sourceExtension } from "../science-session/state";
import { isBrowserSessionWorkspace } from "../window-scope";
import { scientificStateFor, useImportedOriginal } from "./scientific-source-state";
import type { useSceneSpectra } from "./scene-spectra";
import type { captureBrowserMcdAdmission } from "./browser-mcd-attachment";

export type McdCompanionTarget = Parameters<typeof captureBrowserMcdAdmission>[0];

/** Availability only; the captured admission owns durable Original and source checks. */
export function useMcdCompanionTarget(document: ViewerDocument | null, scene: ReturnType<typeof useSceneSpectra>): McdCompanionTarget | null {
  const sourceEditing = useSourceEditing(), logical = useLogicalSource(document?.id ?? null);
  const original = useImportedOriginal(document?.id ?? null);
  const session = sourceEditing?.sessionForDocument(document), science = scene?.science, text = scene?.text, index = scene?.index;
  return useMemo(() => {
    if (!document?.virtual || !document.path.startsWith("/") || !isBrowserSessionWorkspace() || logical || !original || !sourceEditing
      || sourceExtension(document) !== "xyz" || !science || text == null || index == null || !science.frames[index]
      || session?.dirty || (session && session.content !== text)
      || scientificStateFor(document.id, text).revision?.document !== science) return null;
    return { document, science, sourceText: text, sourceFrameIndex: index, sourceEditing };
  }, [document, science, text, index, sourceEditing, original, session, logical]);
}
