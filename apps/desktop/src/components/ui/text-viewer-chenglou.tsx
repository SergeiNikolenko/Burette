"use client";

import * as React from "react";

import { PlainTextViewerFrame } from "./plain-text-viewer-frame";
import { TextViewerContent } from "./text-viewer-chenglou-content";
import { TextViewerFallback } from "./text-viewer-chrome";
import type { TextViewerHandle, TextViewerProps } from "./text-viewer-types";

export const ChenglouTextViewer = React.forwardRef<
  TextViewerHandle,
  TextViewerProps
>(function ChenglouTextViewer(props, ref) {
  return (
    <PlainTextViewerFrame
      props={props}
      forwardedRef={ref}
      clientFallbackPolicy="always"
      Fallback={TextViewerFallback}
      Content={TextViewerContent}
    />
  );
});
