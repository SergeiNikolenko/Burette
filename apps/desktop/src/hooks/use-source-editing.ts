import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm as confirmDialog, message as messageDialog } from "@tauri-apps/plugin-dialog";
import type { SourceEditingContextValue, SourceEditingView } from "../lib/source-editing/context";
import { SourcePreviewAdapter } from "../lib/source-preview/adapter";
import type { SourcePreviewCandidate, SourcePreviewIdentity } from "../lib/source-preview/types";
import { openBrowserDevTextDocument } from "../lib/browser-dev-documents";
import { readStructureTextDocument } from "../lib/structure-text";
import { isTauriRuntime } from "../lib/tauri";
import type { ViewerDocument, ViewerPreferences } from "../types";
import { classifySourceShape, sourceDraftValidationError } from "../lib/source-editing/policy";

const LIVE_PREVIEW_LIMIT = 1_000_000;
const SOURCE_EDIT_LIMIT = 3_000_000;
const LIVE_PREVIEW_DELAY_MS = 450;
const EDITABLE_EXTENSIONS = new Set(["pdb", "ent", "pdbqt", "pqr", "xpdb", "cif", "mmcif", "mcif", "mol", "mol2", "sdf", "sd", "xyz", "gro"]);

type FileRevision = {
  modifiedAt: number;
  byteCount: number;
  contentHash: string;
};

type InternalSourceSession = SourceEditingView & {
  sessionId: string;
  title: string;
  extension: string;
  handleId: string | null;
  revision: number;
  lastValidRevision: number;
  expectedRevision: FileRevision | null;
  baseContent: string;
  previewState: "current" | "queued" | "staging" | "manual" | "paused" | "unsupported";
};

type NativeOpenResult = {
  handleId: string;
  content: string;
  revision: FileRevision;
  previewMode: "live" | "manual";
};

type NativeSaveResult = {
  revision: FileRevision;
};

type NativeSourceError = {
  code?: string;
  message?: string;
  details?: { actualRevision?: FileRevision };
};

type UseSourceEditingOptions = {
  activeDocument: ViewerDocument | null;
  preferences: ViewerPreferences;
  pushErrorStatus: (error: unknown, prefix?: string, details?: string[]) => void;
  setDockOpen: (area: "right" | "bottom", open: boolean) => void;
  setDockActiveTab: (area: "right" | "bottom", kind: "text") => void;
};

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function statusFor(session: Pick<InternalSourceSession, "dirty" | "previewState" | "saving">) {
  if (session.saving) return "Saving…";
  if (!session.dirty) return session.previewState === "paused" ? "Saved — Preview Paused" : "Saved";
  switch (session.previewState) {
    case "queued": return "Edited — Updating Preview…";
    case "staging": return "Updating Preview…";
    case "manual": return "Preview Not Applied";
    case "paused": return "Preview Paused";
    case "unsupported": return "Read Only";
    default: return "Edited";
  }
}

function parseNativeSourceError(error: unknown): NativeSourceError | null {
  const value = typeof error === "string" ? error : error instanceof Error ? error.message : null;
  if (!value) return null;
  try {
    return JSON.parse(value) as NativeSourceError;
  } catch {
    return null;
  }
}

export function useSourceEditingController({
  activeDocument,
  preferences,
  pushErrorStatus,
  setDockActiveTab,
  setDockOpen,
}: UseSourceEditingOptions): SourceEditingContextValue {
  const [sessions, setSessions] = useState<Record<string, InternalSourceSession>>({});
  const sessionsRef = useRef(sessions);
  const adaptersRef = useRef(new Map<string, SourcePreviewAdapter>());
  const timersRef = useRef(new Map<string, number>());
  const savingPathsRef = useRef(new Set<string>());
  const stagingWindowsRef = useRef(new Map<WindowProxy, { path: string; identity: SourcePreviewIdentity }>());

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const clearStagingWindows = useCallback((path: string, identity?: SourcePreviewIdentity) => {
    for (const [source, staged] of stagingWindowsRef.current) {
      if (staged.path !== path) continue;
      if (identity && (staged.identity.sessionId !== identity.sessionId
        || staged.identity.requestId !== identity.requestId
        || staged.identity.revision !== identity.revision)) continue;
      stagingWindowsRef.current.delete(source);
    }
  }, []);

  const updateSession = useCallback((path: string, update: (session: InternalSourceSession) => InternalSourceSession) => {
    setSessions((current) => {
      const session = current[path];
      if (!session) return current;
      const next = update(session);
      return { ...current, [path]: { ...next, status: statusFor(next) } };
    });
  }, []);

  const beginEditing = useCallback(async (document: ViewerDocument) => {
    const existing = sessionsRef.current[document.path];
    if (existing) {
      setDockOpen("right", true);
      setDockActiveTab("right", "text");
      return;
    }
    const extension = document.extension.toLowerCase().replace(/^\./u, "");
    if (document.virtual || document.dockingRequest || document.mergedCollection || !EDITABLE_EXTENSIONS.has(extension)) {
      pushErrorStatus(new Error("This structure source is read-only in the first live-editing release."), "Edit Source");
      return;
    }

    try {
      const sessionId = randomId();
      let content: string;
      let handleId: string | null = null;
      let expectedRevision: FileRevision | null = null;
      let previewMode: "live" | "manual";
      if (isTauriRuntime()) {
        const opened = await invoke<NativeOpenResult>("open_source_edit_session", {
          request: { documentId: document.id, sessionId },
        });
        content = opened.content;
        handleId = opened.handleId;
        expectedRevision = opened.revision;
        previewMode = opened.previewMode;
      } else {
        const textDocument = await readStructureTextDocument(document.path, {
          id: document.id,
          path: document.path,
          title: document.title,
          extension,
          byteCount: document.byteCount,
        }, { maxBytes: SOURCE_EDIT_LIMIT + 1 });
        if (textDocument.truncated || new TextEncoder().encode(textDocument.content).byteLength > SOURCE_EDIT_LIMIT) {
          throw new Error("Source is larger than the 3 MB editing limit.");
        }
        content = textDocument.content;
        previewMode = new TextEncoder().encode(content).byteLength <= LIVE_PREVIEW_LIMIT ? "live" : "manual";
      }

      const adapter = new SourcePreviewAdapter({
        activeRuntime: { runtimeKey: `source:${document.id}:base`, runtimePath: document.runtimePath },
        onChange: (sourcePreview) => updateSession(document.path, (session) => ({ ...session, sourcePreview })),
        onStageFailure: (identity, reason) => {
          clearStagingWindows(document.path, identity);
          updateSession(document.path, (session) => {
            if (identity.revision !== session.revision) return session;
            return { ...session, previewState: reason === "superseded" ? "queued" : "paused", diagnostic: reason === "timed-out" ? "Preview timed out. The last valid structure is still shown." : session.diagnostic };
          });
        },
      });
      adaptersRef.current.set(document.path, adapter);
      const session: InternalSourceSession = {
        documentId: document.id,
        path: document.path,
        title: document.title,
        extension,
        sessionId,
        handleId,
        expectedRevision,
        baseContent: content,
        content,
        editable: true,
        dirty: false,
        saving: false,
        status: "Saved",
        diagnostic: null,
        previewMode,
        previewState: "current",
        revision: 0,
        lastValidRevision: 0,
        saveDisabledReason: isTauriRuntime() ? null : "Available in desktop app",
        sourcePreview: adapter.getSnapshot(),
      };
      setSessions((current) => ({ ...current, [document.path]: session }));
      setDockOpen("right", true);
      setDockActiveTab("right", "text");
    } catch (error) {
      pushErrorStatus(error, "Edit Source");
    }
  }, [clearStagingWindows, pushErrorStatus, setDockActiveTab, setDockOpen, updateSession]);

  const preparePreview = useCallback(async (document: ViewerDocument, content?: string, revision?: number) => {
    const session = sessionsRef.current[document.path];
    const adapter = adaptersRef.current.get(document.path);
    if (!session || !adapter) return;
    const targetContent = content ?? session.content;
    const targetRevision = revision ?? session.revision;
    const byteCount = new TextEncoder().encode(targetContent).byteLength;
    if (byteCount > SOURCE_EDIT_LIMIT) {
      updateSession(document.path, (current) => ({ ...current, previewState: "unsupported", diagnostic: "Draft exceeds the 3 MB editing limit." }));
      return;
    }
    if (classifySourceShape(session.extension, targetContent) !== "single") {
      updateSession(document.path, (current) => ({ ...current, previewState: "paused", diagnostic: "Collections and multi-frame drafts are read-only in this release." }));
      return;
    }
    const validationError = sourceDraftValidationError(session.extension, targetContent);
    if (validationError) {
      updateSession(document.path, (current) => ({ ...current, previewState: "paused", diagnostic: validationError }));
      return;
    }
    updateSession(document.path, (current) => targetRevision === current.revision ? { ...current, previewState: "staging", diagnostic: null } : current);
    try {
      const candidateDocument = isTauriRuntime()
        ? await invoke<ViewerDocument>("open_text_structure", {
          request: { title: session.title, extension: session.extension, text: targetContent },
          preferences,
          reloadOptions: undefined,
        })
        : await openBrowserDevTextDocument(session.title, session.extension, targetContent, preferences, undefined, document.id);
      if (sessionsRef.current[document.path]?.revision !== targetRevision) return;
      const identity: SourcePreviewIdentity = {
        documentId: document.id,
        sessionId: session.sessionId,
        requestId: randomId(),
        revision: targetRevision,
      };
      const candidate: SourcePreviewCandidate = {
        runtimeKey: `${session.sessionId}:${targetRevision}:${identity.requestId}`,
        runtimePath: candidateDocument.runtimePath,
        identity,
      };
      adapter.stage(candidate);
    } catch (error) {
      if (sessionsRef.current[document.path]?.revision !== targetRevision) return;
      updateSession(document.path, (current) => ({ ...current, previewState: "paused", diagnostic: error instanceof Error ? error.message : String(error) }));
    }
  }, [preferences, updateSession]);

  const updateDraft = useCallback((document: ViewerDocument, content: string) => {
    const session = sessionsRef.current[document.path];
    if (!session) return;
    const adapter = adaptersRef.current.get(document.path);
    const snapshot = adapter?.getSnapshot();
    const staged = snapshot?.slots[snapshot.activeSlot === "primary" ? "secondary" : "primary"];
    if (staged?.identity) adapter?.reject(staged.identity);
    clearStagingWindows(document.path);
    const revision = session.revision + 1;
    const byteCount = new TextEncoder().encode(content).byteLength;
    const previewMode = byteCount <= LIVE_PREVIEW_LIMIT ? "live" : "manual";
    const previewState = byteCount > SOURCE_EDIT_LIMIT ? "unsupported" : previewMode === "manual" ? "manual" : "queued";
    updateSession(document.path, (current) => ({
      ...current,
      content,
      revision,
      dirty: content !== current.baseContent,
      previewMode,
      previewState,
      diagnostic: byteCount > SOURCE_EDIT_LIMIT ? "Draft exceeds the 3 MB editing limit." : null,
    }));
    const previousTimer = timersRef.current.get(document.path);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    if (previewState === "queued") {
      const timer = window.setTimeout(() => {
        timersRef.current.delete(document.path);
        void preparePreview(document, content, revision);
      }, LIVE_PREVIEW_DELAY_MS);
      timersRef.current.set(document.path, timer);
    }
  }, [clearStagingWindows, preparePreview, updateSession]);

  const stagingLoaded = useCallback((document: ViewerDocument, identity: SourcePreviewIdentity, frame: HTMLIFrameElement) => {
    if (frame.contentWindow) stagingWindowsRef.current.set(frame.contentWindow, { path: document.path, identity });
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.source || typeof event.source !== "object") return;
      const staged = stagingWindowsRef.current.get(event.source as WindowProxy);
      if (!staged) return;
      const envelope = event.data as { source?: unknown; body?: { type?: unknown; message?: unknown; renderer?: unknown; molstarStructureCount?: unknown } } | null;
      if (envelope?.source !== "burrete-viewer" || !envelope.body || typeof envelope.body.type !== "string") return;
      const adapter = adaptersRef.current.get(staged.path);
      if (!adapter) return;
      if (envelope.body.type === "error") {
        adapter.reject(staged.identity);
        stagingWindowsRef.current.delete(event.source as WindowProxy);
        updateSession(staged.path, (session) => staged.identity.revision === session.revision
          ? { ...session, previewState: "paused", diagnostic: typeof envelope.body?.message === "string" ? envelope.body.message : "Preview failed. The last valid structure is still shown." }
          : session);
        return;
      }
      if (envelope.body.type !== "ready") return;
      if (sessionsRef.current[staged.path]?.revision !== staged.identity.revision) {
        adapter.reject(staged.identity);
        stagingWindowsRef.current.delete(event.source as WindowProxy);
        return;
      }
      if (envelope.body.renderer === "molstar" && Number(envelope.body.molstarStructureCount ?? 0) < 1) {
        adapter.reject(staged.identity);
        stagingWindowsRef.current.delete(event.source as WindowProxy);
        updateSession(staged.path, (session) => staged.identity.revision === session.revision
          ? { ...session, previewState: "paused", diagnostic: "The draft did not produce a molecular structure. The last valid structure is still shown." }
          : session);
        return;
      }
      stagingWindowsRef.current.delete(event.source as WindowProxy);
      void adapter.ready(staged.identity).then((result) => {
        if (result.status !== "promoted") return;
        updateSession(staged.path, (session) => staged.identity.revision === session.revision
          ? { ...session, previewState: "current", lastValidRevision: staged.identity.revision, diagnostic: null }
          : session);
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [updateSession]);

  const save = useCallback(async (document: ViewerDocument) => {
    const session = sessionsRef.current[document.path];
    if (!session?.dirty || !session.handleId || !session.expectedRevision || savingPathsRef.current.has(document.path)) return;
    savingPathsRef.current.add(document.path);
    updateSession(document.path, (current) => ({ ...current, saving: true }));
    try {
      if (session.previewState !== "current" || session.lastValidRevision !== session.revision) {
        const confirmed = isTauriRuntime()
          ? await confirmDialog("The current draft has not produced a valid preview. Save it anyway?", {
            title: "Unverified Source Draft",
            kind: "warning",
            okLabel: "Save Anyway",
            cancelLabel: "Cancel",
          })
          : window.confirm("The current draft has not produced a valid preview. Save it anyway?");
        if (!confirmed) return;
      }
      const persist = (overwriteConfirmedRevision: FileRevision | null) => invoke<NativeSaveResult>("save_source_document", {
        request: {
          handleId: session.handleId,
          content: session.content,
          expectedRevision: session.expectedRevision,
          overwriteConfirmedRevision,
        },
      });
      const applySavedRevision = (revision: FileRevision) => {
        updateSession(document.path, (current) => ({
          ...current,
          expectedRevision: revision,
          baseContent: session.content,
          dirty: current.content !== session.content,
          diagnostic: null,
        }));
      };
      try {
        const result = await persist(null);
        applySavedRevision(result.revision);
      } catch (error) {
        const sourceError = parseNativeSourceError(error);
        const conflictRevision = sourceError?.code === "source_conflict" ? sourceError.details?.actualRevision : undefined;
        if (conflictRevision) {
          if (sessionsRef.current[document.path]?.revision !== session.revision) {
            updateSession(document.path, (current) => ({ ...current, diagnostic: "The draft changed while saving. Save again to resolve the disk conflict." }));
            return;
          }
          const overwrite = await confirmDialog(
            "The source changed on disk after editing began. Overwrite those external changes with this draft?",
            { title: "Source Changed on Disk", kind: "warning", okLabel: "Overwrite", cancelLabel: "Cancel" },
          );
          if (overwrite) {
            try {
              const result = await persist(conflictRevision);
              applySavedRevision(result.revision);
              return;
            } catch (retryError) {
              error = retryError;
            }
          } else {
            updateSession(document.path, (current) => ({ ...current, diagnostic: "The file changed on disk. Your draft remains unsaved." }));
            return;
          }
        }
        const finalSourceError = parseNativeSourceError(error);
        if (finalSourceError?.code === "source_commit_uncertain") {
          try {
            const result = await invoke<NativeSaveResult>("reconcile_source_commit", { request: { handleId: session.handleId } });
            applySavedRevision(result.revision);
            return;
          } catch (reconcileError) {
            error = reconcileError;
          }
        }
        updateSession(document.path, (current) => ({ ...current, diagnostic: parseNativeSourceError(error)?.message ?? (error instanceof Error ? error.message : String(error)) }));
      }
    } finally {
      savingPathsRef.current.delete(document.path);
      updateSession(document.path, (current) => ({ ...current, saving: false }));
    }
  }, [updateSession]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "s") return;
      if (!activeDocument || !sessionsRef.current[activeDocument.path]?.editable) return;
      event.preventDefault();
      void save(activeDocument);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeDocument, save]);

  const hasDirtySessions = Object.values(sessions).some((session) => session.dirty);
  useEffect(() => {
    if (!hasDirtySessions) return undefined;
    if (!isTauriRuntime()) {
      const onBeforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }
    const appWindow = getCurrentWindow();
    let disposed = false;
    let closeConfirmed = false;
    let unlisten: (() => void) | undefined;
    void appWindow.onCloseRequested(async (event) => {
      const savingCount = [...savingPathsRef.current].length;
      if (savingCount > 0) {
        event.preventDefault();
        await messageDialog(
          savingCount === 1 ? "A source file is still being saved. Wait for it to finish before closing." : `${savingCount} source files are still being saved. Wait for them to finish before closing.`,
          { title: "Save in Progress", kind: "info" },
        );
        return;
      }
      const dirtyCount = Object.values(sessionsRef.current).filter((session) => session.dirty).length;
      if (dirtyCount === 0 || closeConfirmed) return;
      event.preventDefault();
      const confirmed = await confirmDialog(
        dirtyCount === 1
          ? "Discard the unsaved source edit and close this window?"
          : `Discard unsaved source edits in ${dirtyCount} documents and close this window?`,
        { title: "Unsaved Source Changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" },
      );
      if (confirmed) {
        closeConfirmed = true;
        await appWindow.close();
      }
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [hasDirtySessions]);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    for (const adapter of adaptersRef.current.values()) adapter.dispose();
  }, []);

  const closeDocuments = useCallback((documentIds: string[]) => {
    const targets = Object.values(sessionsRef.current).filter((session) => documentIds.includes(session.documentId));
    if (targets.some((session) => savingPathsRef.current.has(session.path))) {
      window.alert("This source is still being saved. Wait for it to finish before closing the document.");
      return false;
    }
    const dirtyCount = targets.filter((session) => session.dirty).length;
    if (dirtyCount > 0 && !window.confirm(
      dirtyCount === 1
        ? "Discard the unsaved source edit and close this document?"
        : `Discard unsaved source edits in ${dirtyCount} documents and close them?`,
    )) return false;
    for (const session of targets) {
      const timer = timersRef.current.get(session.path);
      if (timer !== undefined) window.clearTimeout(timer);
      timersRef.current.delete(session.path);
      adaptersRef.current.get(session.path)?.dispose();
      adaptersRef.current.delete(session.path);
      clearStagingWindows(session.path);
      if (session.handleId) {
        void invoke("close_source_edit_session", { request: { handleId: session.handleId } }).catch(() => {});
      }
    }
    if (isTauriRuntime()) {
      for (const documentId of documentIds) {
        void invoke("close_opened_source_document", { request: { documentId } }).catch(() => {});
      }
    }
    setSessions((current) => Object.fromEntries(
      Object.entries(current).filter(([, session]) => !documentIds.includes(session.documentId)),
    ));
    return true;
  }, [clearStagingWindows]);

  return useMemo(() => ({
    sessionForDocument: (document: ViewerDocument | null) => document ? sessions[document.path] ?? null : null,
    beginEditing,
    updateDraft,
    applyPreview: (document: ViewerDocument) => preparePreview(document),
    save,
    stagingLoaded,
    closeDocuments,
  }), [beginEditing, closeDocuments, preparePreview, save, sessions, stagingLoaded, updateDraft]);
}
