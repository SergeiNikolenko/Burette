import type { ViewerDocument } from "../../types";
import { compressedName } from "../compressed-files/formats";
import { decodeCompressedFile } from "../compressed-files/task";
import { readBrowserDevVirtualTextDocument } from "../browser-dev-documents";
import type { SourceEditingContextValue, SourceEditingView } from "../source-editing/context";
import { readStructureText } from "../structure-text";
import { requestViewerAction } from "../viewer-bridge";
import { scientificStateFor } from "../workbench/scientific-source-state";
import { encodeScienceSession } from "./codec";
import { sha256Hex } from "../source-editing/source-identity";
import { ScienceSessionError, SCIENCE_SESSION_LIMITS } from "./contracts";
import { checkBindingReport, checkSceneShowsSource, type ScienceSceneBinding, type SceneScienceBindingReport } from "./scene-binding";
export { checkBindingReport, checkSceneShowsSource, type SceneScienceBindingReport } from "./scene-binding";
import { readSdfSource } from "./sdf-source";
import { readSceneDocumentBytes } from "./source-bytes";
import { atomIdsAlong, documentUuidFor, logicalSourceFor, plainAtomIds, sourceExtension } from "./state";


export type SceneScienceExport =
  /** The scene carries this state: send `action`, then `confirm()` before writing the archive. */
  | { kind: "science"; action: Record<string, unknown>; confirm: () => void | Promise<void> }
  /** Scientific state exists but this scene cannot carry it; saved without it and said so. */
  | { kind: "unsupported"; reason: string };

type ExportOptions = {
  sourceEditing: SourceEditingContextValue | null;
  /** Files and records in the scene; a scene of several cannot bind one source. */
  sceneFileCount: number;
  isOpen: (documentId: string) => boolean;
  request?: typeof requestViewerAction;
};


function sourceSession(options: ExportOptions, document: ViewerDocument) {
  return options.sourceEditing?.sessionForDocument(document) ?? null;
}

/**
 * Prepares the scientific part of Export → Scene for exactly the revision the scene shows.
 * Returns null when the document has no scientific source (the scene is saved as before).
 */
export async function prepareSceneScienceExport(document: ViewerDocument, options: ExportOptions): Promise<SceneScienceExport | null> {
  const extension = sourceExtension(document) === "sd" ? "sdf" : sourceExtension(document);
  if (document.renderer !== "molstar" || document.dockingRequest || document.mergedCollection || (extension !== "xyz" && extension !== "sdf")) return null;
  const request = options.request ?? requestViewerAction;
  const session: SourceEditingView | null = sourceSession(options, document);
  const logical = logicalSourceFor(document.id);
  let text: string;
  let virtualText: string | null = null;
  if (session) text = session.content;
  else if (logical) text = logical.text;
  else {
    if (document.byteCount > SCIENCE_SESSION_LIMITS.sourceBytes) return extension === "sdf" ? { kind: "unsupported", reason: "The graph source exceeds the 16 MiB scene limit." } : null;
    virtualText = readBrowserDevVirtualTextDocument(document.path);
    text = virtualText ?? await readStructureText(document.path);
  }
  const state = scientificStateFor(document.id, text);
  const carriesScience = Boolean(extension === "sdf" || logical || state.revision || state.original);
  if (options.sceneFileCount > 1) {
    return carriesScience ? { kind: "unsupported", reason: "Scientific data belongs to one structure, and this scene now has several." } : null;
  }
  // A plain XYZ the scene does not show exactly (an unapplied draft, another structure) is
  // saved as the Mol* scene alone, as before; scientific data is never saved for another scene.
  if (session && session.previewState !== undefined && session.previewState !== "current") {
    if (!carriesScience) return null;
    throw new ScienceSessionError("binding", "The scene does not show the current source yet. Wait for it to update, then save again.");
  }
  let report: SceneScienceBindingReport;
  try {
    report = checkBindingReport(await request(document.id, { type: "scene_science_binding", ...(extension === "sdf" ? { sourceExtension: "sdf" } : {}) }));
  } catch (error) {
    if (!carriesScience) return null;
    if (extension === "sdf") throw error;
    return { kind: "unsupported", reason: error instanceof Error ? error.message : String(error) };
  }
  let frames: ReturnType<typeof checkSceneShowsSource>;
  try {
    frames = checkSceneShowsSource(report, text, extension);
    if (extension === "sdf" && report.sourceSha256 !== await sha256Hex(text)) throw new ScienceSessionError("binding", "The scene does not show the current graph source yet. Wait for it to update, then save again.");
  } catch (error) {
    if (!carriesScience) return null;
    throw error;
  }
  const atomIds = extension === "sdf" ? readSdfSource(text).atomIds : state.revisions
    ? atomIdsAlong(state.revisions, state.position, (index) => state.revisions![index].document.atoms.length)
    : plainAtomIds(document.id, frames[0].elements);
  const binding: ScienceSceneBinding = {
    structureRef: report.structureRef, modelRef: report.modelRef, trajectoryRef: report.trajectoryRef,
    frameIndex: report.frameIndex, frameCount: report.frameCount, atomCount: report.atomCount,
  };
  // A graph's Original is the exact opened file, independent of its edited logical source.
  const originalBytes = extension === "sdf" && !logical && !state.original ? await readSceneDocumentBytes(document, SCIENCE_SESSION_LIMITS.sourceBytes) : null;
  if (originalBytes && originalBytes.byteLength > SCIENCE_SESSION_LIMITS.sourceBytes) throw new ScienceSessionError("limit", "The original graph source exceeds 16 MiB.");
  if (originalBytes) {
    const baseline = session ? session.baseContent : text;
    let originalText: string;
    if (compressedName(document.path)) originalText = (await decodeCompressedFile(document.path, new Blob([originalBytes as BlobPart]), { maxBytes: SCIENCE_SESSION_LIMITS.sourceBytes })).text;
    else {
      try { originalText = new TextDecoder("utf-8", { fatal: true }).decode(originalBytes); }
      catch { throw new ScienceSessionError("source", "The original graph source is not UTF-8 text."); }
    }
    if (baseline === undefined || originalText !== baseline.replace(/^\uFEFF/u, "")) throw new ScienceSessionError("source", "The original graph file changed. Reopen it before saving the scene.");
  }
  const originalDigest = originalBytes ? await sha256Hex(originalBytes) : null;
  const encoded = await encodeScienceSession({
    documentUuid: documentUuidFor(document.id),
    source: { extension, text },
    atomIds,
    binding,
    science: extension === "xyz" ? state.revision?.document ?? null : null,
    original: state.original ?? (originalBytes ? { name: document.path.split("/").pop() || document.title, file: new Blob([originalBytes as BlobPart]) } : null),
  });
  const action = {
    type: "workspace_scene_snapshot",
    science: { binding, positions: Float64Array.from(frames[report.frameIndex].positions), ...(extension === "sdf" ? { sourceSha256: report.sourceSha256 } : {}), assets: encoded.assets },
  };
  // The archive holds this revision only if nothing changed while it was serialized.
  const confirm = () => {
    const changed = () => { throw new ScienceSessionError("source", "The source changed while the scene was being saved. Save the scene again."); };
    if (!options.isOpen(document.id)) throw new ScienceSessionError("source", "The document closed while the scene was being saved.");
    const now = sourceSession(options, document);
    if (session ? now?.content !== text || (now.previewState !== undefined && now.previewState !== "current") : now && now.content !== text) changed();
    if (logicalSourceFor(document.id) !== logical) changed();
    const after = scientificStateFor(document.id, text);
    if (after.revision !== state.revision || after.original !== state.original) changed();
    if (originalDigest) return readSceneDocumentBytes(document, SCIENCE_SESSION_LIMITS.sourceBytes).then(async bytes => {
      if (await sha256Hex(bytes) !== originalDigest) changed();
      if (!options.isOpen(document.id) || sourceSession(options, document)?.content !== now?.content || logicalSourceFor(document.id) !== logical) changed();
      const latest = scientificStateFor(document.id, text);
      if (latest.revision !== state.revision || latest.original !== state.original) changed();
    });
    if (!session && !logical) {
      const currentVirtual = readBrowserDevVirtualTextDocument(document.path);
      if (virtualText !== null || currentVirtual !== null) {
        if (currentVirtual !== text) changed();
      } else {
        // Files have no synchronous source revision. Re-read after serialization, then
        // check the host state again because it may have changed during that read.
        return readStructureText(document.path).then((current) => {
          if (current !== text) changed();
          if (!options.isOpen(document.id)) throw new ScienceSessionError("source", "The document closed while the scene was being saved.");
          if (sourceSession(options, document) !== now || logicalSourceFor(document.id) !== logical) changed();
          const latest = scientificStateFor(document.id, text);
          if (latest.revision !== state.revision || latest.original !== state.original) changed();
        });
      }
    }
  };
  return { kind: "science", action, confirm };
}
