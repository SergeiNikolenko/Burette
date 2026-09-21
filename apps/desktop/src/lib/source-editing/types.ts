export type FileRevision = {
  modifiedAt: number;
  byteCount: number;
  contentHash: string;
};

export type SourceNotEditableReason =
  | "unsupported_format"
  | "unsupported_shape"
  | "truncated"
  | "lossy_encoding"
  | "too_large"
  | "virtual_source"
  | "generated_source"
  | "combined_source"
  | "docking_source"
  | "compressed_source"
  | "binary_source"
  | "multi_source";

export type SourceEditPersistence =
  | { kind: "desktop"; handleId: string }
  | { kind: "preview-only"; reason: "browser_save_unavailable" };

export type SourceEditDiskState =
  | "read-only"
  | "clean"
  | "dirty"
  | "saving"
  | "reconciling"
  | "conflict"
  | "closed";

export type SourcePreviewState =
  | "current"
  | "queued"
  | "staging"
  | "paused"
  | "manual"
  | "unsupported";

export type SourcePreviewMode = "live" | "manual";
export type SourcePreviewUnsupportedReason = "size" | "shape";

export type SourcePreviewDiagnosticCode =
  | "preview_invalid"
  | "preview_unavailable"
  | "source_shape_unsupported";

export type SourcePreviewDiagnostic = {
  code: SourcePreviewDiagnosticCode;
  message: string;
  revision: number;
  line: number | null;
  column: number | null;
};

export type SourceEditSession = {
  sessionId: string;
  documentId: string;
  sourcePath: string;
  title: string;
  extension: string;
  persistence: SourceEditPersistence;
  baseContent: string;
  draftContent: string;
  expectedFileRevision: FileRevision;
  diskState: SourceEditDiskState;
  editMode: boolean;
  draftRevision: number;
  lastValidRevision: number;
  previewState: SourcePreviewState;
  previewMode: SourcePreviewMode;
  previewUnsupportedReason: SourcePreviewUnsupportedReason | null;
  diagnostic: SourcePreviewDiagnostic | null;
  lastConflictRevision: FileRevision | null;
};

export type SourceEditSessionSnapshot = Pick<
  SourceEditSession,
  | "sessionId"
  | "documentId"
  | "sourcePath"
  | "title"
  | "extension"
  | "persistence"
  | "baseContent"
  | "expectedFileRevision"
  | "previewMode"
>;

export type OpenSourceEditSessionResult = {
  handleId: string;
  sessionId: string;
  documentId: string;
  path: string;
  title: string;
  extension: string;
  language: string;
  encoding: "utf-8";
  decodeLossy: false;
  content: string;
  revision: FileRevision;
  previewMode: SourcePreviewMode;
  maximumByteCount: number;
};

export type InspectSourceEditSessionResult = {
  status: "unchanged" | "changed";
  revision: FileRevision;
};

export type SaveSourceDocumentResult = {
  handleId: string;
  path: string;
  revision: FileRevision;
};

export type ReconcileSourceCommitResult = {
  status: "committed";
  handleId: string;
  revision: FileRevision;
};

export type CloseSourceEditSessionResult = {
  handleId: string;
  released: true;
};

export type PrepareSourcePreviewResult = {
  candidateId: string;
  requestId: string;
  sessionId: string;
  sourceDocumentId: string;
  revision: number;
  runtimePath: string;
  renderer: string;
  byteCount: number;
};

export type SourceEditErrorCode =
  | "source_conflict"
  | "source_document_not_open"
  | "source_handle_invalid"
  | "source_missing"
  | "source_permission_denied"
  | "source_not_editable"
  | "source_too_large"
  | "source_write_failed"
  | "source_commit_uncertain"
  | "source_read_failed";

export type SourceEditError = {
  code: SourceEditErrorCode;
  message: string;
  details?: Record<string, unknown>;
};
