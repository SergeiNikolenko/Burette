import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { abortOpenDocumentClaims } from "../lib/open-document-claims";
import { currentDocumentRegistryRevision } from "../lib/native-menu";
import { tracePerf } from "../lib/perf-trace";
import { useMoleculeStore } from "../stores/molecule-store";
import type { OpenDocumentsResult, ViewerDocument, ViewerPreferences } from "../types";

type Preparation = { users: number; promise: Promise<ViewerDocument | null> };
const preparations = new Map<ViewerDocument, Preparation>();
let preparationQueue: Promise<void> = Promise.resolve();

function retainPreparation(document: ViewerDocument, preferences: ViewerPreferences) {
  let preparation = preparations.get(document);
  if (!preparation) {
    const entry: Preparation = { users: 0, promise: Promise.resolve(null) };
    const stillCurrent = () => entry.users > 0 && useMoleculeStore.getState().documents.includes(document);
    entry.promise = preparationQueue.then(async () => {
      if (!stillCurrent()) return null;
      tracePerf("document:prepare-start", { detail: { documentId: document.id } });
      const result = await invoke<OpenDocumentsResult>("open_documents", {
        paths: [document.path], preferences: { ...preferences, ...document.runtimeDeferredPreferences },
        openStateRevision: currentDocumentRegistryRevision(),
      });
      if (!stillCurrent()) {
        await abortOpenDocumentClaims(result.documents);
        return null;
      }
      const replacement = result.documents.find((candidate) => candidate.path === document.path);
      if (!replacement) throw new Error(result.errors[0] ?? "The structure could not be opened.");
      try {
        useMoleculeStore.getState().replaceDocument(document.id, replacement);
      } catch (error) {
        await abortOpenDocumentClaims(result.documents);
        throw error;
      }
      tracePerf("document:prepare-complete", { detail: { documentId: document.id } });
      return replacement;
    }).finally(() => preparations.delete(document));
    // One active native preparation for mounted cold scenes. Closed/evicted
    // queued scenes are skipped, and obsolete in-flight claims are released.
    preparationQueue = entry.promise.then(() => {}, () => {});
    preparations.set(document, entry);
    preparation = entry;
  }
  preparation.users++;
  return { promise: preparation.promise, release: () => { preparation.users--; } };
}

export function useDeferredViewerRuntime(document: ViewerDocument, preferences: ViewerPreferences) {
  const [failure, setFailure] = useState<{ document: ViewerDocument; error: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!document.runtimeDeferred) return;
    let cancelled = false;
    const preparation = retainPreparation(document, preferences);
    void preparation.promise.catch((error) => {
      if (!cancelled) setFailure({ document, error });
    });
    return () => { cancelled = true; preparation.release(); };
  }, [document, preferences, attempt]);
  return {
    error: failure?.document === document ? failure.error : null,
    retry: () => { setFailure(null); setAttempt((value) => value + 1); },
  };
}

// Source editing also needs the real runtime before it captures a base preview.
export async function prepareDeferredViewerRuntime(document: ViewerDocument, preferences: ViewerPreferences) {
  if (!document.runtimeDeferred) return document;
  const preparation = retainPreparation(document, preferences);
  try {
    const prepared = await preparation.promise;
    if (!prepared || !useMoleculeStore.getState().documents.includes(prepared) || prepared.runtimeDeferred) throw new Error("The structure closed or changed while opening.");
    return prepared;
  } finally {
    preparation.release();
  }
}
