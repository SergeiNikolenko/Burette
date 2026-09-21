"use client";

import * as React from "react";

import {
  isResourceError,
  isViewerFormatError,
  isViewerStateError,
  isViewerUnsupportedError,
  ViewerFormatError,
} from "@/lib/viewer-errors";
import {
  createViewerResource,
  viewerContentRenderKey,
  viewerResourceRenderKey,
  type ViewerResource,
} from "@/lib/viewer-resource";
import type {
  BlobViewerSource,
  TextSource,
  UrlViewerSource,
} from "@/lib/viewer-source";

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type TextViewerBounds,
} from "./plain-text-resource";
import { useIsClient } from "./use-is-client";
import { ViewerErrorBoundary } from "./viewer-error";

type TextResourceSource = UrlViewerSource | BlobViewerSource | TextSource;
type ClientFallbackPolicy = "always" | "non-inline-source";
type ContentResetPolicy = "content" | "inline-retry";

export interface PlainTextViewerFrameProps<
  THandle,
  TProps extends PlainTextViewerFramePublicProps,
> {
  props: TProps;
  resource?: ViewerResource;
  forwardedRef: React.ForwardedRef<THandle>;
  clientFallbackPolicy: ClientFallbackPolicy;
  contentResetPolicy?: ContentResetPolicy;
  Fallback: React.ComponentType<PlainTextViewerFallbackProps>;
  Content: React.ComponentType<
    TProps & {
      resource: ViewerResource;
      retryVersion: number;
      forwardedRef?: React.ForwardedRef<THandle>;
    }
  >;
}

export interface PlainTextViewerFramePublicProps extends TextViewerBounds {
  source?: TextResourceSource;
  className?: string;
  controls?: boolean;
  download?: boolean;
  bare?: boolean;
}

export interface PlainTextViewerFallbackProps {
  className?: string;
  controls?: boolean;
  download?: boolean;
  bare?: boolean;
}

export function PlainTextViewerFrame<
  THandle,
  TProps extends PlainTextViewerFramePublicProps,
>({
  props,
  resource: resourceProp,
  forwardedRef,
  clientFallbackPolicy,
  contentResetPolicy = "content",
  Fallback,
  Content,
}: PlainTextViewerFrameProps<THandle, TProps>) {
  const [retryState, setRetryState] = React.useState({
    contentKey: "",
    version: 0,
  });
  const isClient = useIsClient();
  const { source } = props;
  const createdResource = React.useMemo(
    () => (source ? createViewerResource(source) : null),
    [source],
  );
  const resource = resourceProp ?? createdResource;
  if (!resource) {
    throw new Error("PlainTextViewerFrame requires a source or resource.");
  }
  const contentBaseKey = plainTextViewerContentBaseKey(resource, props);
  const retryVersion =
    retryState.contentKey === contentBaseKey ? retryState.version : 0;
  const resetKey = plainTextViewerResetKey(resource, props, retryVersion);
  const contentResetKey = plainTextViewerContentResetKey(
    contentBaseKey,
    retryVersion,
  );
  const suspenseResetKey =
    contentResetPolicy === "inline-retry" && resource.sourceKind === "text"
      ? String(retryVersion)
      : contentResetKey;

  if (
    !isClient &&
    shouldRenderClientFallback(clientFallbackPolicy, resource.sourceKind)
  ) {
    return (
      <Fallback
        className={props.className}
        controls={props.controls}
        download={props.download}
        bare={props.bare}
      />
    );
  }

  return (
    <ViewerErrorBoundary
      bare={props.bare}
      className={props.className}
      download={
        props.controls === false || props.download === false
          ? null
          : plainTextViewerDownloadAction(resource)
      }
      format="text"
      mapError={plainTextViewerBoundaryError}
      resetKey={resetKey}
      sourceKind={resource.sourceKind}
      onRetry={() =>
        setRetryState((state) => ({
          contentKey: contentBaseKey,
          version: state.contentKey === contentBaseKey ? state.version + 1 : 1,
        }))
      }
    >
      <React.Suspense
        key={suspenseResetKey}
        fallback={
          <Fallback
            className={props.className}
            controls={props.controls}
            download={props.download}
            bare={props.bare}
          />
        }
      >
        <Content
          {...props}
          forwardedRef={forwardedRef}
          retryVersion={retryVersion}
          resource={resource}
        />
      </React.Suspense>
    </ViewerErrorBoundary>
  );
}

function plainTextViewerDownloadAction(resource: ViewerResource) {
  return resource.originalDownload;
}

function plainTextViewerBoundaryError(error: unknown) {
  if (
    isResourceError(error) ||
    isViewerFormatError(error) ||
    isViewerStateError(error) ||
    isViewerUnsupportedError(error)
  ) {
    return error;
  }

  return new ViewerFormatError({
    format: "text",
    kind: "render_failed",
    message: "Failed to render text.",
    cause: error,
  });
}

function plainTextViewerResetKey(
  resource: ViewerResource,
  props: Pick<PlainTextViewerFramePublicProps, "maxBytes" | "maxLines">,
  retryVersion: number,
): string {
  const [maxBytesKey, maxLinesKey] = plainTextViewerBoundsResetKey(props);
  return [
    viewerResourceRenderKey(resource),
    retryVersion,
    maxBytesKey,
    maxLinesKey,
  ].join("\u0000");
}

function plainTextViewerContentResetKey(
  contentBaseKey: string,
  retryVersion: number,
): string {
  return [contentBaseKey, retryVersion].join("\u0000");
}

function plainTextViewerContentBaseKey(
  resource: ViewerResource,
  props: Pick<PlainTextViewerFramePublicProps, "maxBytes" | "maxLines">,
): string {
  const [maxBytesKey, maxLinesKey] = plainTextViewerBoundsResetKey(props);
  return [
    viewerContentRenderKey(resource.content),
    maxBytesKey,
    maxLinesKey,
  ].join("\u0000");
}

function plainTextViewerBoundsResetKey(
  props: Pick<PlainTextViewerFramePublicProps, "maxBytes" | "maxLines">,
) {
  return [
    plainTextViewerBoundResetKeyPart(props.maxBytes, DEFAULT_MAX_BYTES),
    plainTextViewerBoundResetKeyPart(props.maxLines, DEFAULT_MAX_LINES),
  ] as const;
}

function plainTextViewerBoundResetKeyPart(
  value: number | undefined,
  defaultValue: number,
) {
  return String(value === undefined ? defaultValue : value);
}

function shouldRenderClientFallback(
  policy: ClientFallbackPolicy,
  sourceKind: TextResourceSource["kind"],
) {
  return policy === "always" || sourceKind !== "text";
}
