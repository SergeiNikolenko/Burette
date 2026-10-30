import { subscribeImports, registeredRevision, claimRegisteredRevision } from "./scientific-source-state";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ScientificDocument } from "../molecular-workbench/scientific-types";
import { readStructureText } from "../structure-text";
import type { ViewerDocument } from "../../types";
import { logicalSourceFor, sourceExtension, useLogicalSource } from "../science-session/state";
import { runReaderTask } from "./reader-task";
import { useSourceText } from "../source-editing/use-structure-source-text";

export { sourceExtension };

// Formats whose text may carry frames, energies, orbitals or normal modes.
const SCIENTIFIC_EXTENSIONS = new Set(["out", "log", "xyz", "cube", "cub", "molden", "hess", "fchk", "fch"]);
const CACHE_LIMIT = 6;

export function documentExtension(document: Pick<ViewerDocument, "extension">) {
  return document.extension.replace(/^\./u, "").toLowerCase();
}

function documentFileName(document: ViewerDocument) {
  const base = document.path.split("/").pop() || document.title || "structure";
  // A restored scene's source is parsed as the text it is, never as the archive.
  const logical = logicalSourceFor(document.id);
  if (logical) return `${base.replace(/\.[a-z0-9]+$/iu, "")}.${logical.extension}`;
  // A normalized virtual XYZ keeps the durable upload path only as its Original identity.
  if (document.virtual && documentExtension(document) === "xyz") return `${base.replace(/\.[a-z0-9]+$/iu, "")}.xyz`;
  return /\.[a-z0-9]+$/iu.test(base) ? base : `${base}.${documentExtension(document)}`;
}

export { useStructureSourceText } from "../source-editing/use-structure-source-text";

// Several mounted surfaces ask about the same document's science (its docks, Info,
// Compute, the command palette). They share one read of the file while any of them
// is mounted; the next surface to mount after that reads the file again.
type SharedRead = { text: Promise<string>; users: number };
const reads = new Map<ViewerDocument, SharedRead>();
function acquireSharedRead(identity: ViewerDocument, path: string) {
  let entry = reads.get(identity);
  if (!entry) { entry = { text: readStructureText(path), users: 0 }; reads.set(identity, entry); }
  entry.users++;
  const held = entry;
  return { text: held.text, release: () => { if (--held.users <= 0 && reads.get(identity) === held) reads.delete(identity); } };
}

export { newImportToken, registerImportedScientificSource, addDocumentInternalCoordinates, claimImportedSource, forgetImportedSource, importedOriginalFor, adoptRestoredScientificSource, releaseScopedScientificSource, scientificStateFor, revisionIndex, recordImportedRevision, useImportedRevisions, useImportedOriginal, releaseClosedImports } from "./scientific-source-state";
export type { ImportedOriginal, ImportedRevision } from "./scientific-source-state";

const parsed = new Map<string, { text: string; promise: Promise<ScientificDocument | null> }>();
function parseOnce(key: string, name: string, text: string) {
  const cached = parsed.get(key);
  if (cached?.text === text) return cached.promise;
  // A file without scientific sections is an ordinary structure, not an error.
  const promise = runReaderTask({ action: "parse", name, text }).catch(() => null);
  parsed.set(key, { text, promise });
  while (parsed.size > CACHE_LIMIT) parsed.delete(parsed.keys().next().value!);
  return promise;
}

export type ScientificState = { document: ScientificDocument | null; text: string | null };

/** Parsed frames, energies, orbitals and modes for the document's current source. */
export function useScientificDocument(document: ViewerDocument | null): ScientificState {
  // Subscribes before the extension is read: a restore completing later re-renders with it.
  useLogicalSource(document?.id ?? null);
  const eligible = Boolean(document && (document.renderer === "molstar" || document.renderer === "xyzrender-external") && !document.mergedCollection
    && !document.dockingRequest && SCIENTIFIC_EXTENSIONS.has(sourceExtension(document)));
  const { text } = useSourceText(eligible ? document : null, acquireSharedRead);
  const [state, setState] = useState<ScientificState & { key: string | null }>({ document: null, text: null, key: null });
  const key = eligible && document ? `${document.id}\u0000${document.path}` : null;
  // A revision's data is read in the same render as its text (the store value itself is the
  // snapshot), so moving between revisions never shows the document without it for a frame,
  // and data given to the current text later (a conversion) applies at once.
  const registered = useSyncExternalStore(subscribeImports, () => (key && document && text !== null ? registeredRevision(document.id, text)?.revision.document ?? null : null));
  useEffect(() => {
    if (!key || !document || text === null || claimRegisteredRevision(document.id, text)) return undefined;
    let current = true;
    void parseOnce(key, documentFileName(document), text).then((value) => { if (current) setState({ document: value, text, key }); });
    return () => { current = false; };
  }, [key, text, registered]);
  if (registered && text !== null) return { document: registered, text };
  return state.key === key && state.text === text ? state : { document: null, text: null };
}

// The viewer reports frame changes; remember the latest per document so a panel
// mounted later starts at the frame the trajectory toolbar shows.
type FrameState = { frameIndex: number; frameCount: number };
const frames = new Map<string, FrameState>();
const frameListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("burette:trajectory-frame-changed", (event) => {
    const detail = (event as CustomEvent<Record<string, unknown>>).detail;
    const documentId = String(detail?.documentId || "");
    if (!documentId) return;
    const frameCount = Math.max(1, Math.trunc(Number(detail.frameCount) || 1));
    frames.set(documentId, { frameIndex: Math.max(0, Math.min(frameCount - 1, Math.trunc(Number(detail.frameIndex) || 0))), frameCount });
    frameListeners.forEach((listener) => listener());
  });
}
const subscribeFrames = (listener: () => void) => { frameListeners.add(listener); return () => { frameListeners.delete(listener); }; };

export function useTrajectoryFrame(documentId: string | null) {
  return useSyncExternalStore(subscribeFrames, () => (documentId ? frames.get(documentId) ?? null : null));
}
