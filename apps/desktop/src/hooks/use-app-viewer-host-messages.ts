import { useCallback, useRef } from "react";

type RefValue<T> = { current: T };
type ViewerMessageSource = "burette-viewer" | "burette-grid" | "burette-agent-viewer";
type ViewerHostMessageBody = Record<string, unknown> | null | undefined;
type PendingMolstarReplaceResolver = (ok: boolean) => void;
type DismissStatus = () => void;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => DismissStatus | void;

type UseAppViewerHostMessagesOptions = {
  pendingMolstarReplaceRef: RefValue<Map<string, PendingMolstarReplaceResolver>>;
  pushStatus: PushStatus;
};

type AgentActionResult = {
  ok?: boolean;
  command?: string;
  action?: string;
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

// Viewer commands report `command`; composite actions such as apply_scene
// report `action`. Failures and retries of the same command share this key.
function agentActionKey(result: AgentActionResult | null) {
  return bodyString(result?.command) || bodyString(result?.action);
}

export function useAppViewerHostMessages({
  pendingMolstarReplaceRef,
  pushStatus,
}: UseAppViewerHostMessagesOptions) {
  // Failure toasts are persistent. Keep the latest one per command so a later
  // success of that command (the agent's retry) withdraws it, while failures of
  // other commands that were never recovered stay visible.
  const failureToastsRef = useRef(new Map<string, DismissStatus>());

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
      const actionKey = agentActionKey(result);
      failureToastsRef.current.get(actionKey)?.();
      failureToastsRef.current.delete(actionKey);
      if (result?.ok) return true;
      const code = typeof result?.error?.code === "string" ? result.error.code : "";
      const mismatch = STRUCTURE_MISMATCH_CODES.has(code);
      const actionDetails = result?.error?.details ? JSON.stringify(result.error.details).slice(0, 1600) : null;
      const dismiss = pushStatus(mismatch ? "Structure action did not match the structure" : "Structure action failed", "error", [
        result?.error?.message ?? (mismatch ? "No matching atoms were reported by the viewer" : "The viewer did not report a reason"),
        code ? `${result?.command ? `${result.command}: ` : ""}${code}` : null,
        actionDetails,
      ].filter((detail): detail is string => Boolean(detail)));
      if (dismiss) failureToastsRef.current.set(actionKey, dismiss);
      return true;
    }

    return false;
  }, [pendingMolstarReplaceRef, pushStatus]);

  return { handleViewerHostMessage };
}
