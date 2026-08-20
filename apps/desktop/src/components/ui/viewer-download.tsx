"use client";

import * as React from "react";
import { Download } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ViewerDownloadError,
  type ViewerDownloadAction,
  type ViewerDownloadPayload,
} from "@/lib/viewer-download-actions";

import { Spinner } from "@/components/ui/retab-spinner";

import { Button, buttonVariants } from "./retab-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./retab-dropdown-menu";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

export interface TriggerViewerDownloadOptions {
  signal?: AbortSignal;
}

export async function triggerViewerDownload(
  action: ViewerDownloadAction,
  options?: TriggerViewerDownloadOptions,
): Promise<void> {
  if (action.isDisabled) {
    throw new ViewerDownloadError({
      actionId: action.id,
      kind: "disabled",
      message: "This download is disabled.",
    });
  }

  let payload: ViewerDownloadPayload;
  try {
    payload = await action.getPayload(options);
  } catch (error) {
    if (isAbortError(error)) {
      throw new ViewerDownloadError({
        actionId: action.id,
        kind: "aborted",
        message: "Download was cancelled.",
        cause: error,
      });
    }
    throw new ViewerDownloadError({
      actionId: action.id,
      kind: "payload_failed",
      message: "Could not prepare this download.",
      cause: error,
    });
  }

  if (payload.kind === "none") return;
  if (payload.kind === "href") {
    try {
      clickDownload(payload.href, action.fileName);
    } catch (error) {
      throw new ViewerDownloadError({
        actionId: action.id,
        kind: "unsupported",
        message: "Could not start this download.",
        cause: error,
      });
    }
    return;
  }

  try {
    const blob =
      payload.kind === "blob"
        ? payload.blob
        : new Blob([payload.text], {
            type: payload.mimeType ?? "text/plain;charset=utf-8",
          });
    const url = URL.createObjectURL(blob);
    try {
      clickDownload(url, action.fileName);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    throw new ViewerDownloadError({
      actionId: action.id,
      kind: "unsupported",
      message: "Could not start this download.",
      cause: error,
    });
  }
}

export type ViewerDownloadErrorHandler = (
  error: ViewerDownloadError,
  action: ViewerDownloadAction,
) => void;

export interface ViewerDownloadTrigger {
  pendingActionId: string | null;
  triggerDownload: (action: ViewerDownloadAction) => void;
}

export interface ViewerDownloadTriggerOptions {
  /** Reports non-aborted action failures; visible failure UI belongs to consumers. */
  onError?: ViewerDownloadErrorHandler;
  resetKey?: unknown;
}

export interface ViewerDownloadControlProps {
  actions: Array<ViewerDownloadAction | null | undefined>;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  showLabel?: boolean;
  /** Reports non-aborted action failures; visible failure UI belongs to consumers. */
  onError?: ViewerDownloadErrorHandler;
}

export interface ViewerDownloadButtonProps
  extends Omit<ViewerDownloadControlProps, "actions"> {
  action: ViewerDownloadAction | null;
}

export interface ViewerDownloadMenuProps
  extends Omit<ViewerDownloadControlProps, "actions"> {
  actions: ViewerDownloadAction[];
}

export function useViewerDownloadHref(
  action: ViewerDownloadAction | null,
): string | null {
  const shouldCreateHref = action?.origin !== "derived";
  const payload = shouldCreateHref ? getSynchronousPayload(action) : null;

  return shouldCreateHref && payload?.kind === "href" ? payload.href : null;
}

export function useViewerDownloadTrigger({
  onError,
  resetKey = "",
}: ViewerDownloadTriggerOptions = {}): ViewerDownloadTrigger {
  const [pendingActionId, setPendingActionId] = React.useState<string | null>(
    null,
  );
  const abortControllerRef = React.useRef<AbortController | null>(null);

  useKeyedMountEffect(joinEffectKey([resetKey]), () => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  });

  const triggerDownload = React.useCallback(
    (action: ViewerDownloadAction) => {
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setPendingActionId(action.id);
      void triggerViewerDownload(action, { signal: abortController.signal })
        .catch((error) => {
          reportDownloadError(error, action, onError);
        })
        .finally(() => {
          if (abortControllerRef.current === abortController) {
            abortControllerRef.current = null;
            setPendingActionId(null);
          }
        });
    },
    [onError],
  );

  return { pendingActionId, triggerDownload };
}

export function ViewerDownloadControl({
  actions,
  variant = "ghost",
  size = "iconSm",
  className = "size-7",
  showLabel = false,
  onError,
}: ViewerDownloadControlProps) {
  const enabledActions = actions.filter(
    (action): action is ViewerDownloadAction => Boolean(action),
  );

  if (enabledActions.length <= 1) {
    return (
      <ViewerDownloadButton
        action={enabledActions[0] ?? null}
        variant={variant}
        size={size}
        className={className}
        showLabel={showLabel}
        onError={onError}
      />
    );
  }

  return (
    <ViewerDownloadMenu
      actions={enabledActions}
      variant={variant}
      size={size}
      className={className}
      showLabel={showLabel}
      onError={onError}
    />
  );
}

export function ViewerDownloadButton({
  action,
  variant = "ghost",
  size = "iconSm",
  className = "size-7",
  showLabel = false,
  onError,
}: ViewerDownloadButtonProps) {
  const href = useViewerDownloadHref(action);
  const label = action?.label ?? "Download";
  const disabled = !action || action.isDisabled;
  const hasDownloadHref = Boolean(href);
  const { pendingActionId, triggerDownload } = useViewerDownloadTrigger({
    onError,
    resetKey: action,
  });
  const isPending = Boolean(action && pendingActionId === action.id);

  const handleClick = React.useCallback(() => {
    if (!action || hasDownloadHref) return;
    triggerDownload(action);
  }, [action, hasDownloadHref, triggerDownload]);

  if (href) {
    return (
      <a
        href={href}
        download={action?.fileName}
        className={cn(buttonVariants({ variant, size }), className)}
        aria-label={label}
        title={label}
        data-slot="button"
      >
        <Download className={showLabel ? "mr-1.5 size-4" : undefined} />
        {showLabel ? label : null}
      </a>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      aria-label={label}
      title={label}
      disabled={disabled || isPending}
      onClick={handleClick}
    >
      {isPending ? (
        <Spinner className="size-4 animate-spin" />
      ) : (
        <Download className={showLabel ? "mr-1.5 size-4" : undefined} />
      )}
      {showLabel ? label : null}
    </Button>
  );
}

export function ViewerDownloadMenu({
  actions,
  variant = "ghost",
  size = "iconSm",
  className = "size-7",
  showLabel = false,
  onError,
}: ViewerDownloadMenuProps) {
  const actionSetKey = actions.map((action) => action.id).join("\u0000");
  const label = "Download";
  const { pendingActionId, triggerDownload } = useViewerDownloadTrigger({
    onError,
    resetKey: actionSetKey,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={className}
          aria-label={label}
          title={label}
          disabled={pendingActionId != null}
        >
          {pendingActionId != null ? (
            <Spinner className="size-4 animate-spin" />
          ) : (
            <Download className={showLabel ? "mr-1.5 size-4" : undefined} />
          )}
          {showLabel ? label : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            disabled={action.isDisabled || pendingActionId != null}
            onClick={() => triggerDownload(action)}
          >
            <Download />
            <span>{action.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function clickDownload(href: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function getSynchronousPayload(
  action: ViewerDownloadAction | null,
): ViewerDownloadPayload | null {
  if (!action || action.isDisabled) return null;
  const payload = action.getPayload();
  return payload instanceof Promise ? null : payload;
}

function reportDownloadError(
  error: unknown,
  action: ViewerDownloadAction,
  onError: ViewerDownloadErrorHandler | undefined,
) {
  if (!(error instanceof ViewerDownloadError)) return;
  if (error.kind === "aborted") return;
  onError?.(error, action);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
