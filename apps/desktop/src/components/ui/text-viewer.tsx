"use client";

import * as React from "react";

import type { ViewerResource } from "@/lib/viewer-resource";

import { MarkdownGreenfieldContent } from "./markdown-greenfield-content";
import { PlainTextViewerFrame } from "./plain-text-viewer-frame";
import { TextViewerContent } from "./text-viewer-chenglou-content";
import { TextViewerFallback } from "./text-viewer-chrome";
import { resolveTextViewerMode } from "./text-viewer-layout";
import type { TextViewerHandle, TextViewerProps } from "./text-viewer-types";

export type {
  TextDocumentSource,
  TextLineRange,
  TextViewerHandle,
  TextViewerProps,
} from "./text-viewer-types";

export type TextResourceContentProps = Omit<TextViewerProps, "source"> & {
  resource: ViewerResource;
};

type RoutedTextViewerContentProps = Omit<TextViewerProps, "source"> & {
  resource: ViewerResource;
  retryVersion: number;
  forwardedRef?: React.ForwardedRef<TextViewerHandle>;
};

export type TextViewerProviderProps = {
  children: React.ReactNode;
  resource: ViewerResource;
};

export type TextViewerDocumentProps = Omit<
  TextResourceContentProps,
  "resource"
>;

export const TextViewer = React.forwardRef<TextViewerHandle, TextViewerProps>(
  function TextViewer(props, ref) {
    return (
      <PlainTextViewerFrame
        props={props}
        forwardedRef={ref}
        clientFallbackPolicy="always"
        Fallback={TextViewerFallback}
        Content={TextViewerRoutedContent}
      />
    );
  },
);

const TextViewerResourceContext = React.createContext<ViewerResource | null>(
  null,
);

export function TextViewerProvider({
  children,
  resource,
}: TextViewerProviderProps) {
  return (
    <TextViewerResourceContext.Provider value={resource}>
      {children}
    </TextViewerResourceContext.Provider>
  );
}

function useTextViewerResource(): ViewerResource {
  const resource = React.useContext(TextViewerResourceContext);
  if (!resource) {
    throw new Error(
      "TextViewerDocument must be used within TextViewerProvider.",
    );
  }
  return resource;
}

export const TextViewerDocument = React.forwardRef<
  TextViewerHandle,
  TextViewerDocumentProps
>(function TextViewerDocument(props, ref) {
  const resource = useTextViewerResource();
  return <TextResourceContent {...props} ref={ref} resource={resource} />;
});

export const TextResourceContent = React.forwardRef<
  TextViewerHandle,
  TextResourceContentProps
>(function TextResourceContent({ resource, ...props }, ref) {
  return (
    <PlainTextViewerFrame
      props={props}
      resource={resource}
      forwardedRef={ref}
      clientFallbackPolicy="always"
      Fallback={TextViewerFallback}
      Content={TextViewerRoutedContent}
    />
  );
});

function TextViewerRoutedContent(props: RoutedTextViewerContentProps) {
  const mode =
    props.mode ??
    resolveTextViewerMode({
      fileName: props.resource.fileName,
      mimeType: props.resource.content.mimeType,
    });

  if (mode === "markdown") {
    return <MarkdownGreenfieldContent {...props} />;
  }

  return <TextViewerContent {...props} mode="text" />;
}
