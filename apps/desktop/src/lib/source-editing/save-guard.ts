import type { SourceEditSession } from "./types";

export type SaveConfirmationAction = "wait-for-preview" | "apply-preview" | "save-anyway" | "cancel";

export type SourceSaveGuardDecision =
  | { kind: "direct" }
  | { kind: "no-op" }
  | { kind: "reconcile" }
  | { kind: "resolve-conflict" }
  | { kind: "blocked"; reason: "browser_save_unavailable" | "read-only" | "closed" | "saving" | "draft_too_large" }
  | {
      kind: "confirm";
      reason: "preview-pending" | "manual-preview" | "preview-paused" | "unsupported-shape" | "preview-revision-mismatch";
      actions: readonly SaveConfirmationAction[];
    };

export function sourceSaveGuard(session: SourceEditSession): SourceSaveGuardDecision {
  if (session.persistence.kind === "preview-only") return { kind: "blocked", reason: "browser_save_unavailable" };
  if (session.diskState === "closed") return { kind: "blocked", reason: "closed" };
  if (session.diskState === "read-only") return { kind: "blocked", reason: "read-only" };
  if (session.diskState === "clean") return { kind: "no-op" };
  if (session.diskState === "saving") return { kind: "blocked", reason: "saving" };
  if (session.diskState === "reconciling") return { kind: "reconcile" };
  if (session.diskState === "conflict") return { kind: "resolve-conflict" };

  if (session.previewState === "current" && session.lastValidRevision === session.draftRevision) {
    return { kind: "direct" };
  }
  if (session.previewState === "queued" || session.previewState === "staging") {
    return {
      kind: "confirm",
      reason: "preview-pending",
      actions: ["wait-for-preview", "save-anyway", "cancel"],
    };
  }
  if (session.previewState === "manual") {
    return {
      kind: "confirm",
      reason: "manual-preview",
      actions: ["apply-preview", "save-anyway", "cancel"],
    };
  }
  if (session.previewState === "paused") {
    return { kind: "confirm", reason: "preview-paused", actions: ["save-anyway", "cancel"] };
  }
  if (session.previewState === "unsupported") {
    if (session.previewUnsupportedReason === "size") return { kind: "blocked", reason: "draft_too_large" };
    return { kind: "confirm", reason: "unsupported-shape", actions: ["save-anyway", "cancel"] };
  }
  return {
    kind: "confirm",
    reason: "preview-revision-mismatch",
    actions: ["wait-for-preview", "save-anyway", "cancel"],
  };
}
