"use client";

import * as React from "react";

import {
  MarkdownGreenfieldContent,
  type MarkdownViewerProps,
} from "./markdown-greenfield-content";
import type { ViewerResource } from "@/lib/viewer-resource";
import { PlainTextViewerFrame } from "./plain-text-viewer-frame";
import { TextViewerFallback } from "./text-viewer-chrome";
import type { TextViewerHandle } from "./text-viewer-types";

export type { MarkdownViewerProps } from "./markdown-greenfield-content";
export type {
  TextDocumentSource,
  TextLineRange,
  TextViewerHandle,
  TextViewerProps,
} from "./text-viewer-types";

export type MarkdownResourceContentProps = Omit<
  MarkdownViewerProps,
  "source"
> & {
  resource: ViewerResource;
};

export const MarkdownViewer = React.forwardRef<
  TextViewerHandle,
  MarkdownViewerProps
>(function MarkdownViewer(props, ref) {
  return (
    <PlainTextViewerFrame
      props={props}
      forwardedRef={ref}
      clientFallbackPolicy="non-inline-source"
      Fallback={TextViewerFallback}
      Content={MarkdownGreenfieldContent}
    />
  );
});

export const MarkdownResourceContent = React.forwardRef<
  TextViewerHandle,
  MarkdownResourceContentProps
>(function MarkdownResourceContent({ resource, ...props }, ref) {
  return (
    <PlainTextViewerFrame
      props={props}
      resource={resource}
      forwardedRef={ref}
      clientFallbackPolicy="non-inline-source"
      Fallback={TextViewerFallback}
      Content={MarkdownGreenfieldContent}
    />
  );
});
