import { invoke } from "@tauri-apps/api/core";
import type { StructureDragPayload } from "./structure-drag";
import { isTauriRuntime } from "./tauri";

// Sidebar rows start an AppKit file drag so Finder receives real files. An
// in-app drop of that drag reports only file paths, so the row's structure
// payload is kept here and matched back by those paths.
let activeDrag: { entries: string[]; payload: StructureDragPayload } | null = null;

export function canStartNativeFileDrag() {
  return isTauriRuntime() && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
}

/** Resolves when the drag ends: true when a destination accepted the files. */
export function startNativeFileDrag(payload: StructureDragPayload) {
  const entries = payload.entries ?? payload.paths;
  activeDrag = { entries, payload };
  return invoke<boolean>("start_file_drag", { paths: entries });
}

export function nativeFileDragPayload(paths: string[], { consume = false } = {}) {
  const drag = activeDrag;
  if (!drag || drag.entries.length !== paths.length || !paths.every((path) => drag.entries.includes(path))) return null;
  if (consume) activeDrag = null;
  return drag.payload;
}
