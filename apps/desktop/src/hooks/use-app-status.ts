import { useCallback, useEffect, useRef, useState } from "react";

import type { StatusKind, StatusNotice } from "../components/types";
import { normalizeAppError } from "../lib/app-error";

export type RecentStatusError = {
  message: string;
  details: string[];
  timestampMs: number;
};

export function useAppStatus() {
  const [status, setStatus] = useState<StatusNotice | null>(null);
  const statusSequenceRef = useRef(0);
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
    setStatus({
      id: ++statusSequenceRef.current,
      kind,
      message: trimmed,
      details: normalizedDetails,
    });
  }, []);

  const pushErrorStatus = useCallback((error: unknown, prefix?: string, details: string[] = []) => {
    const message = normalizeAppError(error);
    pushStatus(prefix ? `${prefix}: ${message}` : message, "error", details.length > 0 ? details : [message]);
  }, [pushStatus]);

  const clearStatus = useCallback(() => {
    setStatus(null);
  }, []);

  useEffect(() => {
    if (!status || status.kind === "error") return undefined;
    const timeout = window.setTimeout(() => {
      setStatus((current) => (current?.id === status.id ? null : current));
    }, 3200);
    return () => window.clearTimeout(timeout);
  }, [status]);

  return {
    status,
    pushStatus,
    pushErrorStatus,
    clearStatus,
    recentErrorsRef,
  };
}
