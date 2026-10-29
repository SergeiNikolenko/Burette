import type { ViewerDocument } from "../types";
import { activeViewerIframeForDocument } from "./viewer-bridge";
import { readStructureText } from "./structure-text";
import { logicalSourceFor } from "./science-session/state";
import { sameSceneSource } from "./science-session/source-identity";
import { hasScientificSource, scientificStateFor } from "./workbench/scientific-source-state";

export type ScientificExportOwner = {
  current: () => ViewerDocument | null | undefined;
  draft: (document: ViewerDocument) => string | null;
};
const OMISSION_WARNING = "Scientific workbench data (source, Z-matrix, grids, Hessians, original file) is not included; save it with Export → Scene in Burette.";

/** Host-owned scientific data is absent from the public SDK's ordinary Mol* session. */
export async function withScientificExportWarning(
  action: Record<string, unknown>, document: ViewerDocument | null | undefined,
  owner: ScientificExportOwner, request: (frame?: HTMLIFrameElement) => Promise<unknown>,
): Promise<unknown> {
  if (!(action.type === "export_session" || (action.type === "raw_burette_agent" && action.command === "exportSession"))
    || !document || document.renderer !== "molstar") return request();
  const stale = () => ({ ok: false, command: String(action.type), error: { code: "STALE_TARGET", message: "The scientific source or its viewer changed. Export the current document again." } });
  // Ordinary exports need no source read, but acquiring host-owned data while the
  // viewer serializes invalidates an archive that cannot include that data.
  if (!hasScientificSource(document.id)) {
    const result = await request();
    return hasScientificSource(document.id) ? stale() : result;
  }
  const target = { ...document };
  const frame = activeViewerIframeForDocument(document.id, "molstar"), sourceWindow = frame?.contentWindow;
  const src = frame?.getAttribute("src"), srcdoc = frame?.getAttribute("srcdoc");
  const inline = () => owner.draft(document) ?? logicalSourceFor(document.id)?.text ?? null;
  const baseline = inline();
  const current = () => {
    const active = owner.current();
    return active?.id === document.id && sameSceneSource(target, active)
      && frame?.isConnected && frame.dataset.readOnly !== "true" && frame.contentWindow === sourceWindow
      && frame.getAttribute("src") === src && frame.getAttribute("srcdoc") === srcdoc
      && activeViewerIframeForDocument(document.id, "molstar") === frame && inline() === baseline;
  };
  if (!sourceWindow || !current()) return stale();
  try {
    const text = baseline ?? await readStructureText(document.path);
    if (!current()) return stale();
    const state = scientificStateFor(document.id, text);
    const result = await request(frame!);
    if (!current()) return stale();
    const afterText = baseline ?? await readStructureText(document.path);
    if (!current() || afterText !== text) return stale();
    const after = scientificStateFor(document.id, text);
    if (after.revision !== state.revision || after.original !== state.original || after.revisions !== state.revisions) return stale();
    if ((!state.revision && !state.original) || !result || typeof result !== "object" || !("ok" in result) || result.ok !== true) return result;
    const warnings = "warnings" in result && Array.isArray(result.warnings) ? result.warnings : [];
    return warnings.includes(OMISSION_WARNING) ? result : { ...result, warnings: [...warnings, OMISSION_WARNING] };
  } catch {
    return stale();
  }
}
