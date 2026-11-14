import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { ShellActions } from "../../components/types";
import type { ViewerDocument } from "../../types";
import { downloadBase64File, safeExportFileName } from "../file-export";
import { isTauriRuntime } from "../tauri";
import { openWorkbenchDialog } from "./dialog-store";

export const MOVIE_FRAME_RATES = [24, 30, 60] as const;
export type MovieSettings = { seconds: number; fps: (typeof MOVIE_FRAME_RATES)[number]; spin: boolean };

const baseName = (document: ViewerDocument) => safeExportFileName(document.title.replace(/\.[^.]+$/u, "") || "scene");

/** Saves base64 bytes through the Mac app's save panel, or as a browser download. Returns false when cancelled. */
async function saveBytes(name: string, base64: string, mimeType: string, filter: { name: string; extensions: string[] }) {
  if (!isTauriRuntime()) { downloadBase64File(name, base64, mimeType); return true; }
  const outputPath = await save({ title: `Export ${filter.name}`, defaultPath: name, filters: [filter] });
  if (!outputPath) return false;
  await invoke("write_base64_file", { request: { outputPath, contentsBase64: base64 } });
  return true;
}

/** Avogadro's Export → Graphics as SVG: the shown ball-and-stick, licorice or spacefill view from the current camera. */
export async function exportSceneSvg(actions: ShellActions, document: ViewerDocument) {
  const result = await actions.runStructureViewerAction(document, { type: "export_svg", label: "Vector image", notify: false }) as { svg?: unknown } | undefined;
  if (typeof result?.svg !== "string") throw new Error("No vector image was returned.");
  const bytes = new TextEncoder().encode(result.svg);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return saveBytes(`${baseName(document)}.svg`, btoa(binary), "image/svg+xml", { name: "SVG", extensions: ["svg"] });
}

/** Records the 3D view and saves the movie; MP4 where the runtime records it, otherwise WebM. */
export async function recordSceneMovie(actions: ShellActions, document: ViewerDocument, settings: MovieSettings, signal?: AbortSignal) {
  const result = await actions.runStructureViewerAction(document, { type: "record_movie", label: "Movie", notify: false, ...settings }, { signal }) as
    { dataUri?: unknown; type?: unknown } | undefined;
  const dataUri = result?.dataUri, type = result?.type === "video/mp4" ? "video/mp4" : "video/webm";
  if (typeof dataUri !== "string" || !dataUri.startsWith(`data:${type}`)) throw new Error("No movie was returned.");
  const extension = type === "video/mp4" ? "mp4" : "webm";
  return saveBytes(`${baseName(document)}.${extension}`, dataUri.slice(dataUri.indexOf(",") + 1), type, { name: extension.toUpperCase(), extensions: [extension] });
}

export function openMovieDialog(document: ViewerDocument) {
  openWorkbenchDialog({ kind: "movie", document });
}
