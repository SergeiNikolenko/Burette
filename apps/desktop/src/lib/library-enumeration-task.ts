import type { ViewerDocument } from "../types";
import type { LibraryEnumerationProgress, LibraryEnumerationResult } from "../workers/library-enumeration.worker";
import type { LibraryRequest } from "./library-enumeration.mjs";
import { runWorkerTask, type WorkerTaskOptions } from "./molecular-workbench/worker-task";
import { openWorkbenchDialog } from "./workbench/dialog-store";

/** Enumerates a library in its own worker; aborting the signal stops it mid-run. */
export function runLibraryEnumeration(request: LibraryRequest, options: WorkerTaskOptions<LibraryEnumerationProgress> = {}) {
  return runWorkerTask<LibraryEnumerationResult, LibraryEnumerationProgress>(
    () => new Worker(new URL("../workers/library-enumeration.worker.ts", import.meta.url), { type: "module", name: "burette-library-enumeration" }),
    request,
    options,
  );
}

/** Opens Enumerate Library; an active collection becomes the first building-block list. */
export function openEnumerateLibrary(document: ViewerDocument | null) {
  openWorkbenchDialog({ kind: "enumerate-library", document });
}
