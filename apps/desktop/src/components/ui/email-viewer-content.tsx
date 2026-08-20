"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  viewerContentRenderKey,
  type ViewerResource,
} from "@/lib/viewer-resource";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

import { EmailViewer } from "./email-viewer";
import { parseEmlMessage } from "./email-viewer-eml";
import { ViewerFallback } from "./file-viewer-fallback";
import { loadTextResource } from "./file-viewer-text-resource";
import { isAbortError } from "./viewer-abortable-request";
import {
  useViewerControlsRegistration,
  type ViewerControlsState,
} from "./viewer-controls";

export type EmailResourceContentProps = {
  resource: ViewerResource;
  className?: string;
  bare?: boolean;
  controls?: boolean;
  download?: boolean;
  descriptorSignal?: AbortSignal;
};

type EmailLoadState =
  | { status: "loading"; key: unknown }
  | { status: "loaded"; key: unknown; emlText: string }
  | { status: "error"; key: unknown; error: unknown };

export function EmailResourceContent({
  resource,
  className,
  bare,
  controls = true,
  download = true,
  descriptorSignal,
}: EmailResourceContentProps) {
  if (resource.content.payload.kind === "text") {
    return (
      <EmailResourceFrame
        key={viewerContentRenderKey(resource.content)}
        resource={resource}
        emlText={resource.content.payload.text}
        className={className}
        bare={bare}
        controls={controls}
        download={download}
      />
    );
  }
  return (
    <EmailResourceLoader
      resource={resource}
      className={className}
      bare={bare}
      controls={controls}
      download={download}
      descriptorSignal={descriptorSignal}
    />
  );
}

function EmailResourceLoader({
  resource,
  className,
  bare,
  controls,
  download,
  descriptorSignal,
}: {
  resource: ViewerResource;
  className?: string;
  bare?: boolean;
  controls: boolean;
  download: boolean;
  descriptorSignal?: AbortSignal;
}) {
  const content = resource.content;
  const contentKey = content.key;
  const [state, setState] = React.useState<EmailLoadState>({
    status: "loading",
    key: contentKey,
  });

  useKeyedMountEffect(
    joinEffectKey([content, contentKey, descriptorSignal, resource.fileName]),
    () => {
      let active = true;
      const controller = new AbortController();
      const abortLocal = () => controller.abort();
      setState({ status: "loading", key: contentKey });

      if (descriptorSignal?.aborted) {
        abortLocal();
      } else {
        descriptorSignal?.addEventListener("abort", abortLocal, {
          once: true,
        });
      }

      loadTextResource({
        content,
        fileName: resource.fileName,
        signal: controller.signal,
      }).then(
        (emlText) => {
          if (active && !controller.signal.aborted) {
            setState({ status: "loaded", key: contentKey, emlText });
          }
        },
        (error: unknown) => {
          if (!active || isAbortError(error)) return;
          setState({ status: "error", key: contentKey, error });
        },
      );

      return () => {
        active = false;
        descriptorSignal?.removeEventListener("abort", abortLocal);
        abortLocal();
      };
    },
  );

  if (state.key !== contentKey || state.status === "loading") {
    return (
      <ViewerFallback resource={resource} className={className} bare={bare} />
    );
  }
  if (state.status === "error") {
    throw state.error;
  }

  return (
    <EmailResourceFrame
      key={contentKey}
      resource={resource}
      emlText={state.emlText}
      className={className}
      bare={bare}
      controls={controls}
      download={download}
    />
  );
}

function EmailResourceFrame({
  resource,
  emlText,
  className,
  bare,
  download,
}: {
  resource: ViewerResource;
  emlText: string;
  className?: string;
  bare?: boolean;
  controls: boolean;
  download: boolean;
}) {
  const message = React.useMemo(
    () => parseEmlMessage(emlText, { identityKey: resource.content.key }),
    [emlText, resource.content.key],
  );
  useEmailResourceControlsRegistration({
    download,
    downloadAction: resource.originalDownload,
  });

  // The email viewer supplies its own domain chrome (message header, parts
  // sidebar); it tracks the live layout like the csv/html renderers, so it
  // registers no motion resolver — the kernel's identity default is correct.
  return (
    <div
      data-slot="email-file-viewer-content"
      className={cn(
        "bg-background flex min-h-0 flex-1 flex-col overflow-hidden",
        bare ? "h-full" : "min-h-64",
        className,
      )}
    >
      <EmailViewer message={message} className="min-h-0 flex-1" />
    </div>
  );
}

function useEmailResourceControlsRegistration({
  download,
  downloadAction,
}: {
  download: boolean;
  downloadAction: ViewerResource["originalDownload"];
}) {
  const onControlsChange = useViewerControlsRegistration();
  const controlsState = React.useMemo<ViewerControlsState>(
    () => ({
      downloads: download && downloadAction ? [downloadAction] : [],
    }),
    [download, downloadAction],
  );

  useKeyedMountEffect(
    joinEffectKey(["email-controls", onControlsChange, controlsState]),
    () => {
      if (!onControlsChange) return;
      onControlsChange(controlsState);
      return () => onControlsChange(null);
    },
  );
}
