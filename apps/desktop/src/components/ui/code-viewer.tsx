"use client";

import * as React from "react";

import type { ViewerResource } from "@/lib/viewer-resource";

import { CodeViewerFallback } from "./code-viewer-chrome";
import { CodeViewerContent } from "./code-viewer-content";
import type { CodeViewerHandle, CodeViewerProps } from "./code-viewer-types";
import { PlainTextViewerFrame } from "./plain-text-viewer-frame";

export type {
  CodeDocumentSource,
  CodeLineRange,
  CodeViewerHandle,
  CodeViewerProps,
} from "./code-viewer-types";

export type CodeResourceContentProps = Omit<CodeViewerProps, "source"> & {
  resource: ViewerResource;
};

export const CodeViewer = React.forwardRef<CodeViewerHandle, CodeViewerProps>(
  function CodeViewer(props, ref) {
    return (
      <PlainTextViewerFrame
        props={props}
        forwardedRef={ref}
        clientFallbackPolicy="always"
        contentResetPolicy="inline-retry"
        Fallback={CodeViewerFallback}
        Content={CodeViewerContent}
      />
    );
  },
);

export const CodeResourceContent = React.forwardRef<
  CodeViewerHandle,
  CodeResourceContentProps
>(function CodeResourceContent({ resource, ...props }, ref) {
  return (
    <PlainTextViewerFrame
      props={props}
      resource={resource}
      forwardedRef={ref}
      clientFallbackPolicy="always"
      contentResetPolicy="inline-retry"
      Fallback={CodeViewerFallback}
      Content={CodeViewerContent}
    />
  );
});
