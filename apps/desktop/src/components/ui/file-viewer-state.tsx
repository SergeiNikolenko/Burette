"use client";

import * as React from "react";
import { FileBlank, Warning } from "@/components/ui/app-icons";
import { Spinner } from "@/components/ui/spinner";
import { InfoCircle as AlertCircle, FileBlank as FileQuestion } from "@/components/ui/app-icons";

import { cn } from "@/lib/utils";
import type { ViewerDownloadAction } from "@/lib/viewer-download-actions";
import {
  toViewerErrorInfo,
  type ViewerErrorContext,
} from "@/lib/viewer-errors";

import { Button } from "./button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "./empty";
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
    <Empty data-slot={stateSlot(kind)} role={role}
      className={cn("min-h-48 gap-3 rounded-none text-sm", className)} {...props}>
      {icon ? <EmptyMedia aria-hidden data-slot="file-viewer-state-icon"
        className={cn("mb-0 text-(--color-text-secondary)", kind !== "loading" && "[&_svg]:size-8")}>{icon}</EmptyMedia> : null}
      {title || description ? <EmptyHeader className="w-full max-w-72 gap-2 break-words">
        {title ? <EmptyTitle data-slot="file-viewer-state-title" className="text-lg leading-6 font-medium tracking-normal text-(--color-text)">{title}</EmptyTitle> : null}
        {description ? <EmptyDescription data-slot="file-viewer-state-description" className="text-sm text-(--color-text-secondary)">{description}</EmptyDescription> : null}
      </EmptyHeader> : null}
      {children}
      {action ? <div data-slot="file-viewer-state-action" className="flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </Empty>
  );
}

export function FileViewerLoadingState({
  children,
  description,
  icon = <Spinner aria-hidden />,
  title = "Loading…",
  ...props
}: FileViewerStateProps) {
  return (
    <FileViewerStateFrame
      aria-busy="true"
      role="status"
      description={description}
      icon={icon}
      kind="loading"
      title={title}
      {...props}
    >
      {children}
    </FileViewerStateFrame>
  );
}

export function FileViewerUnavailableState({
  description,
  icon = <Warning className="size-5" />,
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
  description,
  icon = <FileBlank className="size-5" />,
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
          <Button type="button" size="xs" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {showDownload && download ? (
          <ViewerDownloadButton
            action={download}
            variant={showRetry ? "secondary" : "default"}
            size="xs"
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
      description={description}
      icon={icon}
      kind="error"
      role="alert"
      title={title ?? info?.userMessage ?? "Could not preview file"}
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
  title = "Preview unavailable",
  ...props
}: FileViewerUnsupportedStateProps) {
  const resolvedDescription = description ?? fileName;

  return (
    <FileViewerStateFrame
      action={
        showDownload && download && !download.isDisabled ? (
          <ViewerDownloadButton
            action={download}
            variant="default"
            size="xs"
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
