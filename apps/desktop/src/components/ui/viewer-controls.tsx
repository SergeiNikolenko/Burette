"use client";

import * as React from "react";
import { Download, Maximize, Minus, Plus, RotateCw } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ViewerDownloadAction } from "@/lib/viewer-download-actions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ViewerDownloadControl,
  type ViewerDownloadErrorHandler,
} from "@/components/ui/viewer-download";

export type ViewerControlPosition =
  | {
      kind: "page" | "slide" | "frame";
      current: number;
      total?: number;
    }
  | {
      label: React.ReactNode;
    };

export type ViewerZoomControl = {
  scale: number | null;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit?: () => void;
  onReset?: () => void;
  fitLabel?: string;
  isDisabled?: boolean;
};

export type ViewerRotateControl = {
  onRotate: () => void;
  isDisabled?: boolean;
};

export type ViewerControlsState = {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  position?: ViewerControlPosition | null;
  zoom?: ViewerZoomControl | null;
  rotate?: ViewerRotateControl | null;
  downloads?: ViewerDownloadAction[];
  loading?: boolean;
  extra?: React.ReactNode;
};

type ViewerControlsRegistration = (state: ViewerControlsState | null) => void;
type ViewerControlsRegistrar = (
  registrationId: symbol,
  state: ViewerControlsState | null,
) => void;

const ViewerControlsRegistrationContext =
  React.createContext<ViewerControlsRegistrar | null>(null);

export function ViewerControlsRegistrationProvider({
  children,
  onControlsChange,
}: {
  children: React.ReactNode;
  onControlsChange: ViewerControlsRegistration;
}) {
  const activeRegistrationRef = React.useRef<symbol | null>(null);
  const registerControls = React.useCallback<ViewerControlsRegistrar>(
    (registrationId, state) => {
      if (state) {
        activeRegistrationRef.current = registrationId;
        onControlsChange(state);
        return;
      }

      if (activeRegistrationRef.current !== registrationId) return;
      activeRegistrationRef.current = null;
      onControlsChange(null);
    },
    [onControlsChange],
  );

  return (
    <ViewerControlsRegistrationContext.Provider value={registerControls}>
      {children}
    </ViewerControlsRegistrationContext.Provider>
  );
}

export function useViewerControlsRegistration(): ViewerControlsRegistration | null {
  const registerControls = React.useContext(ViewerControlsRegistrationContext);
  const registrationId = React.useMemo(
    () => Symbol("viewer-controls-registration"),
    [],
  );

  return React.useMemo(() => {
    if (!registerControls) return null;
    return (state) => registerControls(registrationId, state);
  }, [registerControls, registrationId]);
}

export type ViewerControlsProps = Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  position?: ViewerControlPosition | null;
  zoom?: ViewerZoomControl | null;
  rotate?: ViewerRotateControl | null;
  downloads?: ViewerDownloadAction[];
  onDownloadError?: ViewerDownloadErrorHandler;
  loading?: boolean;
  size?: "default" | "sm";
  extra?: React.ReactNode;
};

export type ViewerControlsSkeletonProps = Omit<
  React.ComponentProps<"div">,
  "title"
> & {
  title?: boolean;
  subtitle?: boolean;
  position?: boolean;
  zoom?: boolean;
  rotate?: boolean;
  download?: boolean;
  extra?: React.ReactNode;
};

export const VIEWER_CONTROLS_HEIGHT_PX = 40;

export function ViewerControls({
  className,
  title,
  subtitle,
  position,
  zoom,
  rotate,
  downloads,
  onDownloadError,
  loading = false,
  size = "default",
  extra,
  ...props
}: ViewerControlsProps) {
  const hasDownloads = Boolean(downloads?.length);
  const hasControls = Boolean(zoom || rotate || hasDownloads || extra);
  const hasPlainTitle = typeof title === "string" || typeof title === "number";
  const hasMetadataGroup = loading || title != null || subtitle != null;

  return (
    <div
      data-slot="viewer-controls"
      className={cn(
        "bg-card flex h-10 flex-shrink-0 items-center gap-1 border-b px-2",
        size === "sm" && "h-9 px-2",
        className,
      )}
      {...props}
    >
      {hasMetadataGroup ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {loading ? (
            <span
              aria-hidden
              className="bg-primary size-2 flex-shrink-0 animate-pulse rounded-full"
            />
          ) : null}
          {title != null ? (
            <div
              className={cn(
                "min-w-0 px-1",
                hasPlainTitle && "truncate text-xs font-medium",
              )}
            >
              {title}
            </div>
          ) : null}
          {subtitle != null ? (
            <span className="text-muted-foreground hidden min-w-0 truncate px-1 text-xs tabular-nums sm:inline">
              {subtitle}
            </span>
          ) : null}
          {position ? (
            <span className="text-muted-foreground flex-shrink-0 px-1 text-xs tabular-nums">
              {formatViewerControlPosition(position)}
            </span>
          ) : null}
        </div>
      ) : position ? (
        <span className="text-muted-foreground flex-shrink-0 px-1 text-xs tabular-nums">
          {formatViewerControlPosition(position)}
        </span>
      ) : (
        <div className="min-w-0 flex-1" />
      )}

      {hasControls ? (
        <div className="ml-auto flex flex-shrink-0 items-center gap-1">
          {zoom ? <ViewerZoomControls zoom={zoom} /> : null}
          {zoom && rotate ? <ViewerControlSeparator /> : null}
          {rotate ? <ViewerRotateControlButton rotate={rotate} /> : null}
          {(zoom || rotate) && hasDownloads ? <ViewerControlSeparator /> : null}
          {hasDownloads ? (
            <ViewerDownloadControl
              actions={downloads ?? []}
              onError={onDownloadError}
            />
          ) : null}
          {(zoom || rotate || hasDownloads) && extra ? (
            <ViewerControlSeparator />
          ) : null}
          {extra}
        </div>
      ) : null}
    </div>
  );
}

export function ViewerControlsSkeleton({
  className,
  title = false,
  subtitle = false,
  position = false,
  zoom = false,
  rotate = false,
  download = false,
  extra,
  ...props
}: ViewerControlsSkeletonProps) {
  const hasControls = zoom || rotate || download || Boolean(extra);

  return (
    <div
      data-slot="viewer-controls-skeleton"
      className={cn(
        "bg-card flex h-10 flex-shrink-0 items-center gap-1 border-b px-2",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {title ? (
          <span className="min-w-0 truncate px-1">
            <Skeleton className="inline-block h-3 w-24 align-middle" />
          </span>
        ) : null}
        {subtitle ? (
          <span className="hidden min-w-0 truncate px-1 sm:inline">
            <Skeleton className="inline-block h-3 w-16 align-middle" />
          </span>
        ) : null}
        {position ? (
          <span className="flex-shrink-0 px-1">
            <Skeleton className="inline-block h-3 w-12 align-middle" />
          </span>
        ) : null}
      </div>

      {hasControls ? (
        <div className="ml-auto flex flex-shrink-0 items-center gap-1">
          {zoom ? (
            <>
              <ViewerControlButton
                disabled
                aria-hidden
                tabIndex={-1}
                label="Zoom out"
              >
                <Minus />
              </ViewerControlButton>
              <span className="w-12 text-center">
                <Skeleton className="inline-block h-3 w-8 align-middle" />
              </span>
              <ViewerControlButton
                disabled
                aria-hidden
                tabIndex={-1}
                label="Zoom in"
              >
                <Plus />
              </ViewerControlButton>
              <ViewerControlButton
                disabled
                aria-hidden
                tabIndex={-1}
                label="Fit width"
              >
                <Maximize />
              </ViewerControlButton>
            </>
          ) : null}
          {zoom && rotate ? <ViewerControlSeparator /> : null}
          {rotate ? (
            <ViewerControlButton
              disabled
              aria-hidden
              tabIndex={-1}
              label="Rotate"
            >
              <RotateCw />
            </ViewerControlButton>
          ) : null}
          {(zoom || rotate) && download ? <ViewerControlSeparator /> : null}
          {download ? (
            <ViewerControlButton
              disabled
              aria-hidden
              tabIndex={-1}
              label="Download"
            >
              <Download />
            </ViewerControlButton>
          ) : null}
          {(zoom || rotate || download) && extra ? (
            <ViewerControlSeparator />
          ) : null}
          {extra}
        </div>
      ) : null}
    </div>
  );
}

export function ViewerControlButton({
  label,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("size-7", className)}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </Button>
  );
}

export function formatViewerControlPosition(position: ViewerControlPosition) {
  if ("label" in position) return position.label;

  const label =
    position.kind === "page"
      ? "Page"
      : position.kind === "slide"
        ? "Slide"
        : "Frame";
  const current =
    position.total == null
      ? position.current
      : Math.min(position.current, position.total);

  return position.total == null
    ? `${label} ${current}`
    : `${label} ${current} of ${position.total}`;
}

function ViewerZoomControls({ zoom }: { zoom: ViewerZoomControl }) {
  const fitLabel = zoom.fitLabel ?? "Fit width";

  return (
    <>
      <ViewerControlButton
        label="Zoom out"
        onClick={zoom.onZoomOut}
        disabled={zoom.isDisabled}
      >
        <Minus />
      </ViewerControlButton>
      {zoom.onReset ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground w-12 text-center text-xs tabular-nums disabled:pointer-events-none disabled:opacity-64"
          title="Reset zoom"
          onClick={zoom.onReset}
          disabled={zoom.isDisabled}
        >
          {zoom.scale == null ? "Fit" : `${Math.round(zoom.scale * 100)}%`}
        </button>
      ) : (
        <span className="text-muted-foreground w-12 text-center text-xs tabular-nums">
          {zoom.scale == null ? "Fit" : `${Math.round(zoom.scale * 100)}%`}
        </span>
      )}
      <ViewerControlButton
        label="Zoom in"
        onClick={zoom.onZoomIn}
        disabled={zoom.isDisabled}
      >
        <Plus />
      </ViewerControlButton>
      {zoom.onFit ? (
        <ViewerControlButton
          label={fitLabel}
          onClick={zoom.onFit}
          disabled={zoom.isDisabled}
        >
          <Maximize />
        </ViewerControlButton>
      ) : null}
    </>
  );
}

function ViewerRotateControlButton({
  rotate,
}: {
  rotate: ViewerRotateControl;
}) {
  return (
    <ViewerControlButton
      label="Rotate"
      onClick={rotate.onRotate}
      disabled={rotate.isDisabled}
    >
      <RotateCw />
    </ViewerControlButton>
  );
}

function ViewerControlSeparator() {
  return <Separator orientation="vertical" className="mx-1 h-4" />;
}
