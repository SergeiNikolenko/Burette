import type { ShellActions } from "../components/types";
import { createFileBatchScene } from "./file-batch-scene";
import { appendScenePayload } from "./workspace-scene-import";
import { useMoleculeStore } from "../stores/molecule-store";
import { isMolstarSceneImportSource } from "../lib/docking-documents";
import { runFileQueue, type FileBatchProgress } from "../lib/file-open-queue";

export type { FileBatchProgress } from "../lib/file-open-queue";

export function isBatchSceneOpen(documentId: string) {
  const store = useMoleculeStore.getState();
  const document = store.documents.find(candidate => candidate.id === documentId);
  return Boolean(document && store.tabs.some(tab => [tab.location, ...tab.back, ...tab.forward]
    .some(location => location.kind === "file" && location.documentId === documentId)));
}

export async function openFileBatch(paths: string[], options: {
  actions: Pick<ShellActions, "openStructurePaths" | "openPaths">;
  mode: "scene" | "tabs";
  targetDocumentId?: string;
  resolvePath?: (path: string) => Promise<string>;
  signal?: AbortSignal;
  onProgress?: (progress: FileBatchProgress) => void;
}): Promise<FileBatchProgress> {
  if (options.mode === "scene" && paths.some(path => !isMolstarSceneImportSource(path))) {
    throw new Error("A shared scene supports PDB, CIF, MOL, MOL2, SDF and XYZ files. Open other files in separate tabs.");
  }
  let documentId = options.targetDocumentId;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const unsubscribe = useMoleculeStore.subscribe(() => {
    if (documentId && !isBatchSceneOpen(documentId)) abort();
  });
  if (documentId && !isBatchSceneOpen(documentId)) abort();
  try {
    const result = await runFileQueue(paths, {
      signal: controller.signal,
      resolvePath: options.resolvePath ?? (async path => path),
      onProgress: progress => options.onProgress?.({ ...progress, documentId }),
      open: async path => {
        controller.signal.throwIfAborted();
        if (options.mode === "tabs") {
          await options.actions.openPaths([path], { shouldApply: () => !controller.signal.aborted, requireSuccess: true });
          controller.signal.throwIfAborted();
          return;
        }
        if (!documentId) {
          const document = await createFileBatchScene(path, controller.signal);
          controller.signal.throwIfAborted();
          if (!isBatchSceneOpen(document.id)) { controller.abort(); controller.signal.throwIfAborted(); }
          documentId = document.id;
        } else {
          await appendScenePayload(documentId, { paths: [path], records: [], items: [] }, { incremental: true, signal: controller.signal });
        }
      },
    });
    return { ...result, documentId };
  } finally {
    unsubscribe();
    options.signal?.removeEventListener("abort", abort);
  }
}
