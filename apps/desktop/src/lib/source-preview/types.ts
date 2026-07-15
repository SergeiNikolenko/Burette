export type SourcePreviewSlot = "primary" | "secondary";

export type SourcePreviewIdentity = {
  documentId: string;
  sessionId: string;
  requestId: string;
  revision: number;
};

export type SourcePreviewRuntime = {
  runtimeKey: string;
  runtimePath: string;
  identity?: SourcePreviewIdentity;
};

export type SourcePreviewCandidate = SourcePreviewRuntime & {
  identity: SourcePreviewIdentity;
};

export type SourcePreviewFrameSnapshot = {
  activeSlot: SourcePreviewSlot;
  slots: Readonly<Record<SourcePreviewSlot, SourcePreviewRuntime | null>>;
};

export type SourcePreviewTransferContext = {
  active: SourcePreviewRuntime;
  staging: SourcePreviewCandidate;
};

export type SourcePreviewPromotionResult =
  | { status: "promoted"; revision: number }
  | { status: "stale" };

export type SourcePreviewStageFailure = "rejected" | "timed-out" | "superseded";

