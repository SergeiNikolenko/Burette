import { useCallback } from "react";

type RefValue<T> = { current: T };
type ViewerMessageSource = "burrete-viewer" | "burrete-grid" | "burrete-agent-viewer";
type ViewerHostMessageBody = Record<string, unknown> | null | undefined;
type PendingMolstarReplaceResolver = (ok: boolean) => void;
type PushStatus = (message: string, kind?: "info" | "success" | "error", details?: string[]) => void;

type UseAppViewerHostMessagesOptions = {
  pendingMolstarReplaceRef: RefValue<Map<string, PendingMolstarReplaceResolver>>;
  pushStatus: PushStatus;
};

type AgentActionResult = {
  ok?: boolean;
  error?: {
    message?: string;
    details?: unknown;
  };
};

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

    if (source === "burrete-agent-viewer" && body?.type === "agent-action-result") {
      if (bodyString(body.id).startsWith("text-selection-")) return true;
      const result = agentActionResult(body.result);
      if (result?.ok) return true;
      const actionDetails = result?.error?.details ? JSON.stringify(result.error.details).slice(0, 1600) : null;
      pushStatus("Structure action did not match the structure", "error", [
        result?.error?.message ?? "No matching atoms were reported by the viewer",
        actionDetails,
      ].filter((detail): detail is string => Boolean(detail)));
      return true;
    }

    return false;
  }, [pendingMolstarReplaceRef, pushStatus]);

  return { handleViewerHostMessage };
}
