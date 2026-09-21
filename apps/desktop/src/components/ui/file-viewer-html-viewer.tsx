"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  viewerContentRenderKey,
  type ViewerResource,
} from "@/lib/viewer-resource";

import { ViewerFallback } from "./file-viewer-fallback";
import { getHtmlViewerSrcDoc } from "./file-viewer-html-srcdoc-cache";
import { loadTextResource } from "./file-viewer-text-resource";
import { isAbortError } from "./viewer-abortable-request";
import { useViewerControlsRegistration } from "./viewer-controls";
import { useZoom, ZoomActions } from "./viewer-zoom";
import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";

type HtmlLoadState =
  | { status: "loading"; key: unknown }
  | { status: "loaded"; key: unknown; html: string }
  | { status: "error"; key: unknown; error: unknown };

export function FileViewerHtmlContent({
  resource,
  className,
  bare,
  controls = true,
  descriptorSignal,
}: {
  resource: ViewerResource;
  className?: string;
  bare?: boolean;
  controls?: boolean;
  descriptorSignal: AbortSignal;
}) {
  if (resource.content.payload.kind === "text") {
    return (
      <FileViewerHtmlContentFrame
        key={viewerContentRenderKey(resource.content)}
        resource={resource}
        html={resource.content.payload.text}
        className={className}
        bare={bare}
        controls={controls}
      />
    );
  }
  return (
    <HtmlFileResource
      resource={resource}
      className={className}
      bare={bare}
      controls={controls}
      descriptorSignal={descriptorSignal}
    />
  );
}

function HtmlFileResource({
  resource,
  className,
  bare,
  controls,
  descriptorSignal,
}: {
  resource: ViewerResource;
  className?: string;
  bare?: boolean;
  controls: boolean;
  descriptorSignal: AbortSignal;
}) {
  const content = resource.content;
  const contentKey = content.key;
  const [state, setState] = React.useState<HtmlLoadState>({
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

      if (descriptorSignal.aborted) {
        abortLocal();
      } else {
        descriptorSignal.addEventListener("abort", abortLocal, { once: true });
      }

      loadTextResource({
        content,
        fileName: resource.fileName,
        signal: controller.signal,
      }).then(
        (html) => {
          if (active && !controller.signal.aborted) {
            setState({ status: "loaded", key: contentKey, html });
          }
        },
        (error: unknown) => {
          if (!active || isAbortError(error)) return;
          setState({ status: "error", key: contentKey, error });
        },
      );

      return () => {
        active = false;
        descriptorSignal.removeEventListener("abort", abortLocal);
        abortLocal();
      };
    },
  );

  if (state.key !== contentKey) {
    return (
      <ViewerFallback resource={resource} className={className} bare={bare} />
    );
  }
  if (state.status === "error") {
    throw state.error;
  }
  if (state.status === "loading") {
    return (
      <ViewerFallback resource={resource} className={className} bare={bare} />
    );
  }

  const { html } = state;
  return (
    <FileViewerHtmlContentFrame
      key={contentKey}
      resource={resource}
      html={html}
      className={className}
      bare={bare}
      controls={controls}
    />
  );
}

function FileViewerHtmlContentFrame({
  resource,
  html,
  className,
  bare,
  controls,
}: {
  resource: ViewerResource;
  html: string;
  className?: string;
  bare?: boolean;
  controls: boolean;
}) {
  const fileName = resource.fileName;
  const { scale, zoom, reset } = useZoom();
  useHtmlControlsRegistration({ reset, scale, zoom });

  return (
    <div
      data-slot="html-file-viewer-content"
      className={cn(
        "bg-card flex min-h-0 flex-1 flex-col overflow-hidden",
        bare ? "h-full" : "min-h-64",
        className,
      )}
    >
      {controls ? (
        <HtmlContentToolbar scale={scale} zoom={zoom} reset={reset} />
      ) : null}
      <SandboxedDoc
        contentKey={resource.content.key}
        html={html}
        title={fileName}
        scale={scale}
      />
    </div>
  );
}

function useHtmlControlsRegistration({
  reset,
  scale,
  zoom,
}: {
  reset: () => void;
  scale: number;
  zoom: (factor: number) => void;
}) {
  const onControlsChange = useViewerControlsRegistration();

  useKeyedMountEffect(
    joinEffectKey([onControlsChange, reset, scale, zoom]),
    () => {
      if (!onControlsChange) return;

      onControlsChange({
        zoom: {
          scale,
          onZoomOut: () => zoom(1 / 1.2),
          onZoomIn: () => zoom(1.2),
          onReset: reset,
        },
      });

      return () => onControlsChange(null);
    },
  );
}

function HtmlContentToolbar({
  scale,
  zoom,
  reset,
}: {
  scale: number;
  zoom: (factor: number) => void;
  reset: () => void;
}) {
  return (
    <div className="bg-card flex h-10 shrink-0 items-center justify-end gap-1 border-b px-2">
      <ZoomActions scale={scale} zoom={zoom} reset={reset} />
    </div>
  );
}

function SandboxedDoc({
  contentKey,
  html,
  title,
  scale = 1,
}: {
  contentKey: string;
  html: string;
  title: string;
  scale?: number;
}) {
  const { containerRef, shouldMountIframe } =
    useLazySandboxedIframeMount(contentKey);
  const srcDoc = React.useMemo(
    () =>
      shouldMountIframe
        ? getHtmlViewerSrcDoc({
            contentKey,
            html,
          })
        : "",
    [contentKey, html, shouldMountIframe],
  );

  return (
    <div
      ref={containerRef}
      className="bg-document flex min-h-0 flex-1 flex-col overflow-auto"
    >
      {shouldMountIframe ? (
        <iframe
          sandbox=""
          srcDoc={srcDoc}
          title={title}
          className="bg-document h-full min-h-0 w-full flex-1 border-0"
          style={{ zoom: scale }}
        />
      ) : null}
    </div>
  );
}

function useLazySandboxedIframeMount(resetKey: string) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [shouldMountIframe, setShouldMountIframe] = React.useState(false);
  const mountEffectKey = shouldMountIframe
    ? null
    : joinEffectKey(["html-iframe-visible", resetKey]);

  useKeyedMountEffect(mountEffectKey, () => {
    if (typeof IntersectionObserver === "undefined") {
      setShouldMountIframe(true);
      return;
    }

    const node = containerRef.current;
    if (!node) {
      setShouldMountIframe(true);
      return;
    }

    let observer: IntersectionObserver | null = null;
    try {
      observer = new IntersectionObserver(
        (entries) => {
          if (
            entries.some(
              (entry) => entry.isIntersecting || entry.intersectionRatio > 0,
            )
          ) {
            setShouldMountIframe(true);
            observer?.disconnect();
          }
        },
        { rootMargin: "512px" },
      );
    } catch {
      setShouldMountIframe(true);
      return;
    }

    observer.observe(node);

    return () => observer.disconnect();
  });

  return { containerRef, shouldMountIframe };
}
