import { useCallback, useRef, useState } from "react";

import type { StatusKind, StatusNotice } from "../components/types";
import { toast } from "../components/ui/toast";
import { trackWebDemoHandledError } from "../lib/web-demo-analytics";

export type RecentStatusError = {
  message: string;
  details: string[];
  timestampMs: number;
};

export type StatusDetailsRequest = {
  kind: StatusKind;
  details: string[];
};

export function statusErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    if (typeof value.message === "string" && value.message.trim()) return value.message;
    if (typeof value.error === "string" && value.error.trim()) return value.error;
    if (value.error && typeof value.error === "object") {
      const nestedMessage = (value.error as Record<string, unknown>).message;
      if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to the platform string below.
    }
  }
  return String(error);
}

export function useAppStatus() {
  const [status, setStatus] = useState<StatusNotice | null>(null);
  const [statusDetails, setStatusDetails] = useState<StatusDetailsRequest | null>(null);
  const recentErrorsRef = useRef<RecentStatusError[]>([]);

  const pushStatus = useCallback((message: string, kind: StatusKind = "info", details: string[] = []) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const normalizedDetails = details.filter(Boolean);
    if (kind === "error") {
      recentErrorsRef.current.push({
        message: trimmed,
        details: normalizedDetails,
        timestampMs: Date.now(),
      });
      recentErrorsRef.current = recentErrorsRef.current.slice(-20);
    }
    setStatus({ kind, message: trimmed });
    if (kind !== "error") return;
    const compact = compactStatusMessage(trimmed);
    const fullDetails = compact === trimmed ? normalizedDetails : [trimmed, ...normalizedDetails];
    toast.add({
      title: compact,
      type: kind,
      timeout: 0,
      priority: "high",
      ...(fullDetails.length > 0
        ? {
            actionProps: {
              children: "Details",
              onClick: () => setStatusDetails({ kind, details: fullDetails }),
            },
          }
        : {}),
    });
  }, []);

  const pushErrorStatus = useCallback((error: unknown, prefix?: string, details: string[] = []) => {
    const message = statusErrorMessage(error);
    trackWebDemoHandledError(error, prefix);
    pushStatus(prefix ? `${prefix}: ${message}` : message, "error", details.length > 0 ? details : [message]);
  }, [pushStatus]);

  const dismissStatusDetails = useCallback(() => {
    setStatusDetails(null);
  }, []);

  return {
    status,
    statusDetails,
    dismissStatusDetails,
    pushStatus,
    pushErrorStatus,
    recentErrorsRef,
  };
}

function compactStatusMessage(message: string) {
  return message.trim().split(/\r?\n| Error:| at /)[0]?.trim() || message;
}
