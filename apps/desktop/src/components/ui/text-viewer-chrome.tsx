"use client";

import * as React from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import { useMountEffect } from "@/hooks/use-mount-effect";

import { type ViewerDownloadAction } from "@/lib/viewer-download-actions";

import { Skeleton } from "./retab-skeleton";
import { TextCodeViewerFrame } from "./text-code-viewer-chrome";
import type { ViewerDownloadErrorHandler } from "./viewer-download";
import {
  ViewerControls,
  ViewerControlButton,
  ViewerControlsSkeleton,
} from "./viewer-controls";

export type ViewerClipboardCopyStatus = "copied" | "failed" | "idle";

export function TextViewerFrame({
  className,
  bare,
  children,
}: {
  className?: string;
  bare?: boolean;
  children: React.ReactNode;
}) {
  return (
    <TextCodeViewerFrame
      bare={bare}
      bareClassName="h-full bg-background"
      className={className}
      dataSlot="text-viewer"
      framedClassName="rounded-xl border bg-background"
    >
      {children}
    </TextCodeViewerFrame>
  );
}

export function TextViewerFallback({
  className,
  controls = true,
  download = true,
  bare,
}: {
  className?: string;
  controls?: boolean;
  download?: boolean;
  bare?: boolean;
}) {
  return (
    <TextViewerFrame className={className} bare={bare}>
      {controls ? (
        <ViewerControlsSkeleton title zoom download={download} />
      ) : null}
      <div
        className="min-h-0 flex-1 space-y-3 overflow-hidden p-5"
        data-slot="text-body-skeleton"
      >
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-4"
            style={{ width: `${48 + ((index * 17) % 44)}%` }}
          />
        ))}
      </div>
    </TextViewerFrame>
  );
}

export function TextViewerControls({
  wordCount,
  fontScale,
  copyText,
  copyLabel = "Copy text",
  downloadAction,
  extra,
  leading,
  onDownloadError,
  onZoomOut,
  onZoomIn,
  onResetZoom,
}: {
  wordCount: number;
  fontScale: number;
  copyText?: string;
  copyLabel?: string;
  downloadAction?: ViewerDownloadAction | null;
  extra?: React.ReactNode;
  leading?: React.ReactNode;
  onDownloadError?: ViewerDownloadErrorHandler;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetZoom: () => void;
}) {
  const copyControl =
    copyText == null ? null : (
      <TextViewerCopyControl label={copyLabel} text={copyText} />
    );

  return (
    <ViewerControls
      title={leading ?? `${wordCount} word${wordCount === 1 ? "" : "s"}`}
      zoom={{
        scale: fontScale,
        onZoomOut,
        onZoomIn,
        onFit: onResetZoom,
        fitLabel: "Reset zoom",
      }}
      downloads={downloadAction ? [downloadAction] : undefined}
      onDownloadError={onDownloadError}
      extra={
        extra == null && copyControl == null ? null : (
          <span className="flex min-w-0 items-center gap-1">
            {extra}
            {copyControl}
          </span>
        )
      }
    />
  );
}

function TextViewerCopyControl({
  label,
  text,
}: {
  label: string;
  text: string;
}) {
  const { copy, status } = useViewerClipboardCopy();

  const copyText = () => {
    copy(text);
  };

  const buttonLabel =
    status === "copied"
      ? "Copied"
      : status === "failed"
        ? "Copy failed"
        : label;

  return (
    <ViewerControlButton label={buttonLabel} onClick={copyText} type="button">
      {status === "copied" ? (
        <Check />
      ) : status === "failed" ? (
        <AlertCircle />
      ) : (
        <Copy />
      )}
    </ViewerControlButton>
  );
}

export function useViewerClipboardCopy({
  resetDelay = 1200,
}: {
  resetDelay?: number;
} = {}) {
  const [status, setStatus] = React.useState<ViewerClipboardCopyStatus>("idle");
  const timeoutRef = React.useRef<number | null>(null);
  const isMountedRef = React.useRef(true);
  const copyAttemptRef = React.useRef(0);

  useMountEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearViewerClipboardCopyReset(timeoutRef);
    };
  });

  const scheduleReset = React.useCallback(() => {
    clearViewerClipboardCopyReset(timeoutRef);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      if (isMountedRef.current) setStatus("idle");
    }, resetDelay);
  }, [resetDelay]);

  const copy = React.useCallback(
    (text: string) => {
      clearViewerClipboardCopyReset(timeoutRef);
      const copyAttempt = copyAttemptRef.current + 1;
      copyAttemptRef.current = copyAttempt;
      const isCurrentAttempt = () =>
        isMountedRef.current && copyAttemptRef.current === copyAttempt;

      try {
        const clipboard = navigator.clipboard;
        const writeText = clipboard?.writeText;
        if (typeof writeText !== "function") {
          setStatus("failed");
          scheduleReset();
          return;
        }

        void Promise.resolve(writeText.call(clipboard, text)).then(
          () => {
            if (!isCurrentAttempt()) return;
            setStatus("copied");
            scheduleReset();
          },
          () => {
            if (!isCurrentAttempt()) return;
            setStatus("failed");
            scheduleReset();
          },
        );
      } catch {
        setStatus("failed");
        scheduleReset();
      }
    },
    [scheduleReset],
  );

  return { copy, status };
}

function clearViewerClipboardCopyReset(
  timeoutRef: React.MutableRefObject<number | null>,
) {
  if (timeoutRef.current === null) return;
  window.clearTimeout(timeoutRef.current);
  timeoutRef.current = null;
}
