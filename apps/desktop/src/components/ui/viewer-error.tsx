"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { ViewerDownloadAction } from "@/lib/viewer-download-actions";
import {
  type ViewerErrorContext,
  type ViewerFormat,
} from "@/lib/viewer-errors";

import { FileViewerErrorState } from "./file-viewer-state";

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
  return <FileViewerErrorState error={error} format={format} sourceKind={sourceKind}
    canDownload={canDownload} retry={retry} download={download} onRetry={onRetry}
    className={cn(errorStateClassName({ bare, variant }), className)} data-slot="viewer-error" />;
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
    return "min-h-24 px-3 py-3 [&_[data-slot=file-viewer-state-icon]]:hidden [&_[data-slot=file-viewer-state-title]]:text-sm";
  }
  return cn(
    bare ? "min-h-0" : "min-h-64",
    variant === "document" && "min-h-full",
  );
}

export type { ViewerFormat };
