import type { TextFileSaveOutcome } from "../file-export";
import type { DockTabKind } from "../dock";
import { createContext, useContext, type ReactNode } from "react";
import { SourceDraftRecoveryDialog } from "../../components/source-draft-recovery-dialog";
import type { ViewerDocument } from "../../types";
import type { SourcePreviewFrameSnapshot, SourcePreviewIdentity } from "../source-preview/types";

/** Whether the scene shows the draft while its replacement preview loads. */
export type SourcePreviewState = "current" | "queued" | "staging" | "manual" | "paused" | "unsupported";

export type SourceEditingView = {
  documentId: string;
  path: string;
  content: string;
  /** Last acknowledged file content, for detecting replacement before export. */
  baseContent?: string;
  editable: boolean;
  dirty: boolean;
  saving: boolean;
  status: string;
  diagnostic: string | null;
  previewMode: "live" | "manual";
  saveDisabledReason: string | null;
  saveLabel?: "Save" | "Save copy";
  sourcePreview: SourcePreviewFrameSnapshot | null;
  previewState?: SourcePreviewState;
};

export type SourceEditingWindowDirtySnapshot = {
  dirty: boolean;
  revision: number;
  closeTransitionActive: boolean;
};

/** Acknowledged geometry edits avoid staging; graph edits may retain the current camera. */
export type DraftUpdateOptions = { previewApplied: true } | { view: "keep" };

/** A pending edit belongs to its open document until release or successful close. */
export type SourceEditingOperation = { isCurrent: () => boolean; release: () => void };

export type SourceDraftRecoveryDraft = Readonly<{
  sessionId: string; documentId: string; path: string; title: string; extension: string; content: string;
}>;
export type SourceDraftRecoveryRequest = Readonly<{
  requestId: string;
  drafts: readonly SourceDraftRecoveryDraft[];
  isCurrent: () => boolean;
  cancel: () => void;
  discard: () => void;
  saveCopy: (sessionId: string) => Promise<TextFileSaveOutcome>;
}>;

export type SourceEditingContextValue = {
  recovery?: SourceDraftRecoveryRequest | null;
  sessionForDocument: (document: ViewerDocument | null) => SourceEditingView | null;
  captureOperation: (document: ViewerDocument) => SourceEditingOperation;
  beginEditing: (document: ViewerDocument, revealTab?: DockTabKind) => void | Promise<void>;
  updateDraft: (document: ViewerDocument, content: string, options?: DraftUpdateOptions) => void;
  applyPreview: (document: ViewerDocument) => void | Promise<void>;
  save: (document: ViewerDocument) => void | Promise<void>;
  stagingLoaded: (document: ViewerDocument, identity: SourcePreviewIdentity, frame: HTMLIFrameElement) => void;
  closeDocuments: (documentIds: string[]) => Promise<boolean>;
  confirmCloseWindow: () => Promise<boolean>;
  getWindowDirtySnapshot: () => SourceEditingWindowDirtySnapshot;
  hasUnsavedOrSavingSessions: boolean;
};

const SourceEditingContext = createContext<SourceEditingContextValue | null>(null);

export function SourceEditingProvider({ value, children }: { value: SourceEditingContextValue; children: ReactNode }) {
  return <SourceEditingContext.Provider value={value}>{children}<SourceDraftRecoveryDialog request={value.recovery ?? null} /></SourceEditingContext.Provider>;
}

export function useSourceEditing() {
  return useContext(SourceEditingContext);
}
