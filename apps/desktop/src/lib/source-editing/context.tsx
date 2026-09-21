import { createContext, useContext, type ReactNode } from "react";
import type { ViewerDocument } from "../../types";
import type { SourcePreviewFrameSnapshot, SourcePreviewIdentity } from "../source-preview/types";

export type SourceEditingView = {
  documentId: string;
  path: string;
  content: string;
  editable: boolean;
  dirty: boolean;
  saving: boolean;
  status: string;
  diagnostic: string | null;
  previewMode: "live" | "manual";
  saveDisabledReason: string | null;
  sourcePreview: SourcePreviewFrameSnapshot | null;
};

export type SourceEditingWindowDirtySnapshot = {
  dirty: boolean;
  revision: number;
  closeTransitionActive: boolean;
};

export type SourceEditingContextValue = {
  sessionForDocument: (document: ViewerDocument | null) => SourceEditingView | null;
  beginEditing: (document: ViewerDocument) => void | Promise<void>;
  updateDraft: (document: ViewerDocument, content: string) => void;
  applyPreview: (document: ViewerDocument) => void | Promise<void>;
  save: (document: ViewerDocument) => void | Promise<void>;
  stagingLoaded: (document: ViewerDocument, identity: SourcePreviewIdentity, frame: HTMLIFrameElement) => void;
  closeDocuments: (documentIds: string[]) => boolean;
  confirmCloseWindow: () => Promise<boolean>;
  getWindowDirtySnapshot: () => SourceEditingWindowDirtySnapshot;
  hasUnsavedOrSavingSessions: boolean;
};

const SourceEditingContext = createContext<SourceEditingContextValue | null>(null);

export function SourceEditingProvider({ value, children }: { value: SourceEditingContextValue; children: ReactNode }) {
  return <SourceEditingContext.Provider value={value}>{children}</SourceEditingContext.Provider>;
}

export function useSourceEditing() {
  return useContext(SourceEditingContext);
}
