import { classifyPreviewMode, utf8ByteCount } from "./policy";
import type {
  FileRevision,
  SourceEditSession,
  SourceEditSessionSnapshot,
  SourcePreviewDiagnostic,
} from "./types";

export type SourceEditAction =
  | { type: "enter-edit-mode" }
  | { type: "edit"; content: string }
  | { type: "start-preview"; revision: number }
  | { type: "preview-ready"; revision: number }
  | { type: "preview-failed"; revision: number; diagnostic: SourcePreviewDiagnostic }
  | { type: "preview-shape-unsupported"; revision: number; diagnostic: SourcePreviewDiagnostic }
  | { type: "start-save" }
  | { type: "save-succeeded"; revision: FileRevision }
  | { type: "save-failed" }
  | { type: "save-conflict"; revision: FileRevision }
  | { type: "save-uncertain" }
  | { type: "reconcile-committed"; revision: FileRevision }
  | { type: "reconcile-conflict"; revision: FileRevision }
  | { type: "keep-editing" }
  | { type: "reload"; content: string; revision: FileRevision }
  | { type: "close" };

export function createSourceEditSession(snapshot: SourceEditSessionSnapshot, editMode = true): SourceEditSession {
  return {
    ...snapshot,
    draftContent: snapshot.baseContent,
    diskState: editMode ? "clean" : "read-only",
    editMode,
    draftRevision: 0,
    lastValidRevision: 0,
    previewState: "current",
    previewUnsupportedReason: null,
    diagnostic: null,
    lastConflictRevision: null,
  };
}

function nextPreviewState(content: string) {
  const mode = classifyPreviewMode(utf8ByteCount(content));
  if (mode === "read-only") {
    return { previewState: "unsupported" as const, previewUnsupportedReason: "size" as const };
  }
  if (mode === "manual") {
    return { previewState: "manual" as const, previewMode: "manual" as const, previewUnsupportedReason: null };
  }
  return { previewState: "queued" as const, previewMode: "live" as const, previewUnsupportedReason: null };
}

function rebaseClean(session: SourceEditSession, revision: FileRevision): SourceEditSession {
  return {
    ...session,
    baseContent: session.draftContent,
    expectedFileRevision: revision,
    diskState: "clean",
    lastConflictRevision: null,
  };
}

export function reduceSourceEditSession(session: SourceEditSession, action: SourceEditAction): SourceEditSession {
  if (session.diskState === "closed") return session;

  switch (action.type) {
    case "enter-edit-mode":
      if (session.diskState !== "read-only") return session;
      return { ...session, diskState: "clean", editMode: true };
    case "edit": {
      if (!session.editMode || session.diskState === "saving" || session.diskState === "reconciling") return session;
      const draftRevision = session.draftRevision + 1;
      const diskState = action.content === session.baseContent ? "clean" : "dirty";
      return {
        ...session,
        draftContent: action.content,
        draftRevision,
        diskState,
        diagnostic: null,
        ...nextPreviewState(action.content),
      };
    }
    case "start-preview":
      if (action.revision !== session.draftRevision) return session;
      if (session.previewState !== "queued" && session.previewState !== "manual") return session;
      return { ...session, previewState: "staging", previewUnsupportedReason: null, diagnostic: null };
    case "preview-ready":
      if (action.revision !== session.draftRevision || session.previewState !== "staging") return session;
      return {
        ...session,
        previewState: "current",
        previewUnsupportedReason: null,
        lastValidRevision: action.revision,
        diagnostic: null,
      };
    case "preview-failed":
      if (action.revision !== session.draftRevision || session.previewState !== "staging") return session;
      return { ...session, previewState: "paused", previewUnsupportedReason: null, diagnostic: action.diagnostic };
    case "preview-shape-unsupported":
      if (action.revision !== session.draftRevision || session.previewState !== "staging") return session;
      return {
        ...session,
        previewState: "unsupported",
        previewUnsupportedReason: "shape",
        diagnostic: action.diagnostic,
      };
    case "start-save":
      if (session.persistence.kind !== "desktop") return session;
      if (session.diskState !== "dirty" && session.diskState !== "conflict") return session;
      return { ...session, diskState: "saving" };
    case "save-succeeded":
    case "reconcile-committed":
      if (action.type === "save-succeeded" && session.diskState !== "saving") return session;
      if (action.type === "reconcile-committed" && session.diskState !== "reconciling") return session;
      return rebaseClean(session, action.revision);
    case "save-failed":
      return session.diskState === "saving" ? { ...session, diskState: "dirty" } : session;
    case "save-conflict":
      if (session.diskState !== "saving" && session.diskState !== "dirty") return session;
      return { ...session, diskState: "conflict", lastConflictRevision: action.revision };
    case "save-uncertain":
      return session.diskState === "saving" ? { ...session, diskState: "reconciling" } : session;
    case "reconcile-conflict":
      if (session.diskState !== "reconciling") return session;
      return { ...session, diskState: "conflict", lastConflictRevision: action.revision };
    case "keep-editing":
      return session.diskState === "conflict" ? { ...session, diskState: "dirty" } : session;
    case "reload": {
      if (session.diskState !== "clean" && session.diskState !== "conflict") return session;
      const contentChanged = action.content !== session.draftContent;
      const draftRevision = contentChanged ? session.draftRevision + 1 : session.draftRevision;
      return {
        ...session,
        baseContent: action.content,
        draftContent: action.content,
        expectedFileRevision: action.revision,
        diskState: "clean",
        draftRevision,
        lastConflictRevision: null,
        diagnostic: null,
        ...(contentChanged ? nextPreviewState(action.content) : {}),
      };
    }
    case "close":
      return { ...session, diskState: "closed", editMode: false };
  }
}
