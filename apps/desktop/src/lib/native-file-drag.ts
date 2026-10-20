import { invoke } from "@tauri-apps/api/core";
import type { StructureDragPayload } from "./structure-drag";
import { isTauriRuntime } from "./tauri";

// Sidebar rows and file tabs start an AppKit drag so Finder receives real files.
// In-app drops report only paths; retain their structure payload and source tab
// identity until the receiving surface consumes the drop.
let activeDrag: { entries: string[]; payload: StructureDragPayload; tabId: string | null } | null = null;

export function canStartNativeFileDrag() {
  return isTauriRuntime() && typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
}

type NativeFileDragOutcome = {
  accepted: boolean;
  /** Release point over this window, in client coordinates, when nothing took the files. */
  inAppDrop: { x: number; y: number } | null;
};

/** Resolves when the drag ends. */
export async function startNativeFileDrag(payload: StructureDragPayload, tabId: string | null = null) {
  const entries = payload.entries ?? payload.paths;
  const drag = { entries, payload, tabId };
  activeDrag = drag;
  try {
    const outcome = await invoke<NativeFileDragOutcome>("start_file_drag", { paths: entries });
    if (!outcome.accepted && activeDrag === drag) activeDrag = null;
    return outcome;
  } catch (error) {
    if (activeDrag === drag) activeDrag = null;
    throw error;
  }
}

export function nativeFileDragTabId(paths: string[]) {
  return nativeFileDragPayload(paths) ? activeDrag?.tabId ?? null : null;
}

export function nativeFileDragPayload(paths: string[], { consume = false } = {}) {
  const drag = activeDrag;
  if (!drag || drag.entries.length !== paths.length || !paths.every((path) => drag.entries.includes(path))) return null;
  if (consume) activeDrag = null;
  return drag.payload;
}
