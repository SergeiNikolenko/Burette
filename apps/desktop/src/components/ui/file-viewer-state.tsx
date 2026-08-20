"use client";

import * as React from "react";
import {
  AlertCircle,
  FileQuestion,
  Inbox,
  Loader2,
  WifiOff,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ViewerDownloadAction } from "@/lib/viewer-download-actions";
import {
  toViewerErrorInfo,
  type ViewerErrorContext,
} from "@/lib/viewer-errors";

import { Button } from "./retab-button";
import { Skeleton } from "./retab-skeleton";
import { ViewerDownloadButton } from "./viewer-download";

type FileViewerStateKind =
  | "empty"
  | "error"
  | "loading"
  | "unavailable"
  | "unsupported";

export type FileViewerStateProps = Omit<
  React.ComponentProps<"div">,
  "title"
> & {
  action?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  title?: React.ReactNode;
};

export type FileViewerErrorStateProps = FileViewerStateProps &
  ViewerErrorContext & {
    canDownload?: boolean;
    download?: ViewerDownloadAction | null;
    error?: unknown;
    onRetry?: () => void;
  };

export type FileViewerUnsupportedStateProps = FileViewerStateProps & {
  download?: ViewerDownloadAction | null;
  fileName?: string;
  showDownload?: boolean;
};

function stateSlot(kind: FileViewerStateKind) {
  return `file-viewer-${kind}-state`;
}

function renderErrorDescription(error: unknown): React.ReactNode {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return undefined;
}

function FileViewerStateFrame({
  action,
  children,
  className,
  description,
  icon,
  kind,
  role,
  title,
  ...props
}: FileViewerStateProps & {
  kind: FileViewerStateKind;
  role?: React.AriaRole;
}) {
  return (
    <div
      data-slot={stateSlot(kind)}
      role={role}
      className={cn(
        "text-muted-foreground flex min-h-48 min-w-0 flex-col items-center justify-center gap-3 p-6 text-center text-sm",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden
          data-slot="file-viewer-state-icon"
          className="text-muted-foreground flex size-9 items-center justify-center"
        >
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-md min-w-0 flex-col items-center gap-1">
        {title ? (
          <p
            data-slot="file-viewer-state-title"
            className="text-foreground text-sm font-medium"
          >
            {title}
          </p>
        ) : null}
        {description ? (
          <p
            data-slot="file-viewer-state-description"
            className="text-muted-foreground text-sm"
          >
            {description}
          </p>
        ) : null}
      </div>
      {children}
      {action ? (
        <div
          data-slot="file-viewer-state-action"
          className="flex items-center justify-center gap-2"
        >
          {action}
        </div>
      ) : null}
    </div>
  );
}

export function FileViewerLoadingState({
  children,
  description = "Preparing the preview.",
  icon = <Loader2 className="size-5 animate-spin" />,
  title = "Loading file",
  ...props
}: FileViewerStateProps) {
  return (
    <FileViewerStateFrame
      aria-busy="true"
      description={description}
      icon={icon}
      kind="loading"
      title={title}
      {...props}
    >
      {children ?? (
        <div
          aria-hidden
          data-slot="file-viewer-state-skeleton"
          className="flex w-full max-w-xs flex-col gap-2"
        >
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-2 w-3/4 self-center" />
        </div>
      )}
    </FileViewerStateFrame>
  );
}

export function FileViewerUnavailableState({
  description = "The file is not available right now.",
  icon = <WifiOff className="size-5" />,
  title = "File unavailable",
  ...props
}: FileViewerStateProps) {
  return (
    <FileViewerStateFrame
      description={description}
      icon={icon}
      kind="unavailable"
      role="status"
      title={title}
      {...props}
    />
  );
}

export function FileViewerEmptyState({
  description = "Choose a file to preview.",
  icon = <Inbox className="size-5" />,
  title = "No file selected",
  ...props
}: FileViewerStateProps) {
  return (
    <FileViewerStateFrame
      description={description}
      icon={icon}
      kind="empty"
      role="status"
      title={title}
      {...props}
    />
  );
}

export function FileViewerErrorState({
  action,
  canDownload,
  description,
  download,
  error,
  format = "file",
  icon = <AlertCircle className="size-5" />,
  onRetry,
  retry,
  sourceKind,
  title,
  ...props
}: FileViewerErrorStateProps) {
  const info =
    error === undefined
      ? null
      : toViewerErrorInfo(error, {
          canDownload: canDownload ?? Boolean(download && !download.isDisabled),
          format,
          retry,
          sourceKind,
        });
  const showRetry = Boolean(info?.isRetryable && onRetry);
  const showDownload = Boolean(
    info?.isDownloadUseful && download && !download.isDisabled,
  );
  const resolvedAction =
    action ??
    (showRetry || showDownload ? (
      <>
        {showRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {showDownload && download ? (
          <ViewerDownloadButton
            action={download}
            variant={showRetry ? "ghost" : "outline"}
            size="sm"
            className=""
            showLabel
          />
        ) : null}
      </>
    ) : null);

  return (
    <FileViewerStateFrame
      action={resolvedAction}
      data-error-domain={info?.domain}
      data-error-format={info?.format}
      data-error-kind={info?.kind}
      data-error-message={info?.message}
      description={
        description ?? info?.userMessage ?? renderErrorDescription(error)
      }
      icon={icon}
      kind="error"
      role="alert"
      title={title ?? "Could not preview file"}
      {...props}
    />
  );
}

export function FileViewerUnsupportedState({
  description,
  download,
  fileName,
  icon = <FileQuestion className="size-5" />,
  showDownload = true,
  title = "Preview unsupported",
  ...props
}: FileViewerUnsupportedStateProps) {
  const resolvedDescription =
    description ??
    (fileName
      ? `No preview is available for ${fileName}.`
      : "No preview is available for this file.");

  return (
    <FileViewerStateFrame
      action={
        showDownload && download && !download.isDisabled ? (
          <ViewerDownloadButton
            action={download}
            variant="outline"
            size="sm"
            className=""
            showLabel
          />
        ) : undefined
      }
      description={resolvedDescription}
      icon={icon}
      kind="unsupported"
      role="status"
      title={title}
      {...props}
    />
  );
}
