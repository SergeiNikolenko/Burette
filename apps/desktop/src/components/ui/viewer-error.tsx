"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ViewerDownloadAction } from "@/lib/viewer-download-actions";
import {
  toViewerErrorInfo,
  type ViewerErrorContext,
  type ViewerFormat,
} from "@/lib/viewer-errors";

import { Button } from "./retab-button";
import { ViewerDownloadButton } from "./viewer-download";

export interface ViewerErrorStateProps extends ViewerErrorContext {
  error: unknown;
  download?: ViewerDownloadAction | null;
  className?: string;
  bare?: boolean;
  variant?: "card" | "document" | "inline";
  onRetry?: () => void;
}

export function ViewerErrorState({
  error,
  format,
  sourceKind,
  canDownload,
  retry,
  download,
  className,
  bare = false,
  variant = "card",
  onRetry,
}: ViewerErrorStateProps) {
  const info = toViewerErrorInfo(error, {
    format,
    sourceKind,
    canDownload: canDownload ?? Boolean(download && !download.isDisabled),
    retry,
  });
  const showRetry = info.isRetryable && onRetry;
  const showDownload =
    info.isDownloadUseful && download != null && !download.isDisabled;

  return (
    <div
      className={cn(errorStateClassName({ bare, variant }), className)}
      data-error-domain={info.domain}
      data-error-format={info.format}
      data-error-kind={info.kind}
      data-error-message={info.message}
      data-slot="viewer-error"
      role="alert"
    >
      <p>{info.userMessage}</p>
      {showRetry || showDownload ? (
        <div className="flex items-center gap-2">
          {showRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw className="mr-1.5 size-4" />
              Retry
            </Button>
          ) : null}
          {showDownload ? (
            <ViewerDownloadButton
              action={download}
              variant={showRetry ? "ghost" : "outline"}
              size="sm"
              className=""
              showLabel
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface ViewerErrorBoundaryProps extends ViewerErrorContext {
  children: React.ReactNode;
  resetKey?: unknown;
  download?: ViewerDownloadAction | null;
  className?: string;
  bare?: boolean;
  variant?: "card" | "document" | "inline";
  mapError?: (error: unknown) => unknown;
  onRetry?: (error: unknown) => void;
  onCaughtError?: (error: unknown, errorInfo: React.ErrorInfo) => void;
}

export class ViewerErrorBoundary extends React.Component<
  ViewerErrorBoundaryProps,
  { error: unknown | null; retryKey: number }
> {
  state: Readonly<{ error: unknown | null; retryKey: number }> = {
    error: null,
    retryKey: 0,
  };

  componentDidUpdate(previousProps: ViewerErrorBoundaryProps) {
    if (
      previousProps.resetKey !== this.props.resetKey &&
      this.state.error != null
    ) {
      this.setState({ error: null });
    }
  }

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    this.props.onCaughtError?.(error, errorInfo);
  }

  render() {
    if (this.state.error != null) {
      const error = this.props.mapError
        ? this.props.mapError(this.state.error)
        : this.state.error;

      return (
        <ViewerErrorState
          error={error}
          format={this.props.format}
          sourceKind={this.props.sourceKind}
          canDownload={this.props.canDownload}
          retry={this.props.retry}
          download={this.props.download}
          className={this.props.className}
          bare={this.props.bare}
          variant={this.props.variant}
          onRetry={() => {
            this.setState((state) => ({
              error: null,
              retryKey: state.retryKey + 1,
            }));
            this.props.onRetry?.(this.state.error);
          }}
        />
      );
    }

    return (
      <React.Fragment key={this.state.retryKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

function errorStateClassName({
  bare,
  variant,
}: {
  bare: boolean;
  variant: "card" | "document" | "inline";
}) {
  if (variant === "inline") {
    return "flex h-24 flex-col items-center justify-center gap-3 px-3 text-center text-xs text-muted-foreground";
  }
  return cn(
    "flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground",
    bare ? "bg-muted/20" : "rounded-xl border bg-muted/30",
    variant === "document" && "min-h-full",
  );
}

export type { ViewerFormat };
