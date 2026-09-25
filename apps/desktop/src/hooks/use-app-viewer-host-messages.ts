import { useCallback } from "react";

type RefValue<T> = { current: T };
type ViewerMessageSource = "burette-viewer" | "burette-grid" | "burette-agent-viewer";
type ViewerHostMessageBody = Record<string, unknown> | null | undefined;
type PendingMolstarReplaceResolver = (ok: boolean) => void;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;

type UseAppViewerHostMessagesOptions = {
  pendingMolstarReplaceRef: RefValue<Map<string, PendingMolstarReplaceResolver>>;
  pushStatus: PushStatus;
};

type AgentActionResult = {
  ok?: boolean;
  command?: string;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

// Only these codes mean the requested atoms or residues were not found in the
// loaded structure. Stale revisions, a missing viewer, invalid arguments and
// out-of-range frames are different failures and must not read as a mismatch.
const STRUCTURE_MISMATCH_CODES = new Set([
  "SELECTION_EMPTY",
  "UNKNOWN_ATOM",
  "UNKNOWN_SELECTION",
  "STALE_SELECTION",
  "ATOM_MAPPING_MISMATCH",
]);

function bodyString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function agentActionResult(value: unknown): AgentActionResult | null {
  return value && typeof value === "object" ? value as AgentActionResult : null;
}

export function useAppViewerHostMessages({
  pendingMolstarReplaceRef,
  pushStatus,
}: UseAppViewerHostMessagesOptions) {
  const handleViewerHostMessage = useCallback((source: ViewerMessageSource, body: ViewerHostMessageBody) => {
    if (body?.type === "molstarStructureReplaced") {
      const requestId = bodyString(body.requestId);
      const resolve = pendingMolstarReplaceRef.current.get(requestId);
      if (resolve) {
        pendingMolstarReplaceRef.current.delete(requestId);
        resolve(true);
      }
      return true;
    }

    if (source === "burette-agent-viewer" && body?.type === "agent-action-result") {
      if (bodyString(body.id).startsWith("text-selection-")) return true;
      const result = agentActionResult(body.result);
      if (result?.ok) return true;
      const code = typeof result?.error?.code === "string" ? result.error.code : "";
      const mismatch = STRUCTURE_MISMATCH_CODES.has(code);
      const actionDetails = result?.error?.details ? JSON.stringify(result.error.details).slice(0, 1600) : null;
      pushStatus(mismatch ? "Structure action did not match the structure" : "Structure action failed", "error", [
        result?.error?.message ?? (mismatch ? "No matching atoms were reported by the viewer" : "The viewer did not report a reason"),
        code ? `${result?.command ? `${result.command}: ` : ""}${code}` : null,
        actionDetails,
      ].filter((detail): detail is string => Boolean(detail)));
      return true;
    }

    return false;
  }, [pendingMolstarReplaceRef, pushStatus]);

  return { handleViewerHostMessage };
}
