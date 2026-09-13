"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { inferCsvDialect } from "@/lib/csv";
import { joinEffectKey } from "@/lib/effect-key";
import { cn } from "@/lib/utils";
import { type ViewerResource } from "@/lib/viewer-resource";
import {
  fileViewerDiagnostic,
  summarizeViewerDescriptor,
  summarizeViewerSource,
} from "@/lib/pdf-viewer-diagnostics";

import {
  isProseTextDescriptor,
  type FileCategory,
  type FileDescriptor,
  type FileViewerFallbackSize,
} from "./file-viewer-core";
import { UnsupportedCard } from "./file-viewer-fallback";
import { FileViewerHtmlContent } from "./file-viewer-html-viewer";
import {
  getFileViewerPrewarmTarget,
  scheduleFileViewerRendererPrewarm,
} from "./file-viewer-prewarm";

const PdfResourceContent = React.lazy(() =>
  import("@/components/ui/pdf-viewer").then((m) => ({
    default: m.PdfResourceContent,
  })),
);
const DocxResourceContent = React.lazy(() =>
  import("@/components/ui/docx-viewer").then((m) => ({
    default: m.DocxResourceContent,
  })),
);
const ImageResourceContent = React.lazy(() =>
  import("@/components/ui/image-viewer").then((m) => ({
    default: m.ImageResourceContent,
  })),
);
const PptxResourceContent = React.lazy(() =>
  import("@/components/ui/pptx-viewer").then((m) => ({
    default: m.PptxResourceContent,
  })),
);
const XlsxResourceContent = React.lazy(() =>
  import("@/components/ui/xlsx-viewer").then((m) => ({
    default: m.XlsxResourceContent,
  })),
);
const ProseTextViewer = React.lazy(() =>
  import("@/components/ui/text-viewer").then((m) => ({
    default: m.TextResourceContent,
  })),
);
const MarkdownViewer = React.lazy(() =>
  import("@/components/ui/markdown-viewer").then((m) => ({
    default: m.MarkdownResourceContent,
  })),
);
const CodeTextViewer = React.lazy(() =>
  import("@/components/ui/code-viewer").then((m) => ({
    default: m.CodeResourceContent,
  })),
);
const EmailResourceContent = React.lazy(() =>
  import("@/components/ui/email-viewer").then((m) => ({
    default: m.EmailResourceContent,
  })),
);
const CsvResourceContent = React.lazy(() =>
  import("@/components/ui/csv-viewer").then((m) => ({
    default: m.CsvResourceContent,
  })),
);

function FileViewerCsvContent({
  resource,
  className,
  bare,
  controls = false,
  isolateStyles,
}: {
  resource: ViewerResource;
  className?: string;
  bare?: boolean;
  controls?: boolean;
  isolateStyles?: boolean;
}) {
  const dialect = inferCsvDialect({
    src: resource.content.directUrl ?? undefined,
    fileName: resource.fileName,
    mimeType: resource.mimeType,
  });
  return (
    <div
      data-slot="csv-file-viewer-content"
      className={cn(
        "bg-card flex min-h-0 flex-1 flex-col overflow-hidden",
        bare ? "h-full" : "min-h-64",
        className,
      )}
    >
      <CsvResourceContent
        resource={resource}
        dialect={dialect}
        fillHeight
        frame={!bare}
        controls={controls}
        isolateStyles={isolateStyles}
      />
    </div>
  );
}

export type FileViewerRouteProps = {
  className?: string;
  descriptor: FileDescriptor;
  descriptorSignal: AbortSignal;
  fallbackFrameSize?: FileViewerFallbackSize;
  fallbackSlideSize?: FileViewerFallbackSize;
  frame?: "contained" | "none";
  isolateStyles: boolean;
  resource: ViewerResource;
  controls: boolean;
};

type RenderContext = {
  descriptor: FileDescriptor;
  resource: ViewerResource;
  className?: string;
  bare: boolean;
  controls: boolean;
  fallbackFrameSize?: FileViewerFallbackSize;
  fallbackSlideSize?: FileViewerFallbackSize;
  isolateStyles: boolean;
  descriptorSignal: AbortSignal;
};

// Categories a text-kind source (raw text, no blob/url backing) can render.
const TEXT_SOURCE_CATEGORIES = new Set<FileCategory>([
  "csv",
  "markdown",
  "html",
  "email",
  "text",
]);

const RENDERERS: Partial<
  Record<FileCategory, (ctx: RenderContext) => React.ReactNode>
> = {
  pdf: ({ resource, className, bare, controls }) => (
    <PdfResourceContent
      resource={resource}
      className={className}
      bare={bare}
      controls={controls}
      download
    />
  ),
  docx: ({ resource, className, bare, controls }) => (
    <DocxResourceContent
      resource={resource}
      className={className}
      bare={bare}
      controls={controls}
      download
    />
  ),
  image: ({ resource, className, bare, controls, fallbackFrameSize }) => (
    <ImageResourceContent
      resource={resource}
      className={className}
      bare={bare}
      controls={controls}
      download
      fallbackFrameSize={fallbackFrameSize}
    />
  ),
  pptx: ({ resource, className, bare, controls, fallbackSlideSize }) => (
    <PptxResourceContent
      resource={resource}
      className={className}
      bare={bare}
      controls={controls}
      download
      fallbackSlideSize={fallbackSlideSize}
    />
  ),
  xlsx: ({ resource, className, bare, controls, isolateStyles }) => (
    <XlsxResourceContent
      resource={resource}
      className={className}
      bare={bare}
      controls={controls}
      download
      isolateStyles={isolateStyles}
    />
  ),
  csv: ({ resource, className, bare, controls, isolateStyles }) => (
    <FileViewerCsvContent
      resource={resource}
      className={className}
      bare={bare}
      controls={controls}
      isolateStyles={isolateStyles}
    />
  ),
  html: ({ resource, className, bare, controls, descriptorSignal }) => (
    <FileViewerHtmlContent
      resource={resource}
      className={className}
      bare={bare}
      controls={controls}
      descriptorSignal={descriptorSignal}
    />
  ),
  email: ({ resource, className, bare, controls, descriptorSignal }) => (
    <EmailResourceContent
      resource={resource}
      className={className}
      bare={bare}
      controls={controls}
      download
      descriptorSignal={descriptorSignal}
    />
  ),
  markdown: ({ resource, className, bare, controls }) => (
    <MarkdownViewer
      resource={resource}
      className={className}
      controls={controls}
      download
      bare={bare}
      urlFragmentNavigation={false}
    />
  ),
  text: renderTextViewer,
};

export function FileViewerRoute({
  descriptor,
  className,
  frame = "contained",
  isolateStyles,
  descriptorSignal,
  fallbackFrameSize,
  fallbackSlideSize,
  resource,
  controls,
}: FileViewerRouteProps) {
  const { category } = descriptor;
  const bare = frame === "none";
  const isTextSource = descriptor.source.kind === "text";

  const renderer = RENDERERS[category];
  const textSourceAllowed =
    !isTextSource || TEXT_SOURCE_CATEGORIES.has(category);
  const isRouteRenderable = Boolean(renderer) && textSourceAllowed;
  const prewarmTarget = getFileViewerPrewarmTarget({
    descriptor,
    isRouteRenderable,
  });
  useKeyedMountEffect(
    prewarmTarget
      ? joinEffectKey(["file-viewer-renderer-prewarm", prewarmTarget])
      : null,
    () => {
      if (!prewarmTarget) return;
      return scheduleFileViewerRendererPrewarm(prewarmTarget);
    },
  );

  const routeDetails = {
    bare,
    category,
    hasRenderer: Boolean(renderer),
    isTextSource,
    isolateStyles,
    source: summarizeViewerSource(descriptor.source),
    descriptor: summarizeViewerDescriptor(descriptor),
    controls,
  };
  if (renderer && textSourceAllowed) {
    fileViewerDiagnostic("debug", "file_viewer_route_renderer_selected", {
      ...routeDetails,
      textSourceAllowed,
    });
    return renderer({
      descriptor,
      resource,
      className,
      bare,
      controls,
      fallbackFrameSize,
      fallbackSlideSize,
      isolateStyles,
      descriptorSignal,
    });
  }

  fileViewerDiagnostic("warn", "file_viewer_route_unsupported", {
    ...routeDetails,
    textSourceAllowed,
  });
  return (
    <UnsupportedCard
      resource={resource}
      className={className}
      bare={bare}
      showDownload={controls}
    />
  );
}

function renderTextViewer({
  descriptor,
  resource,
  className,
  bare,
  controls,
}: RenderContext): React.ReactNode {
  if (isProseTextDescriptor(descriptor)) {
    return (
      <ProseTextViewer
        resource={resource}
        className={className}
        controls={controls}
        download
        bare={bare}
        mode="text"
      />
    );
  }
  return (
    <CodeTextViewer
      resource={resource}
      className={className}
      controls={controls}
      download
      bare={bare}
    />
  );
}
