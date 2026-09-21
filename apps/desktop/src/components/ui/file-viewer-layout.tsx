"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import {
  useOptionalFileViewerShellStatic,
  useFileViewerShellStatic,
} from "./file-viewer-context";
import {
  FileViewerDocumentFrameProvider,
  type FileViewerDocumentFrameState,
} from "./file-viewer-renderer-frame";
import { type FileViewerDocumentAlign } from "./file-viewer-renderer-contract";
import { useStableElementSize } from "./viewer-measurement";

const FileViewerContentContext = React.createContext(false);
const FileViewerInsetContext = React.createContext(false);
const FileViewerViewportContext = React.createContext(false);

export function useIsInsideFileViewerContent(): boolean {
  return React.useContext(FileViewerContentContext);
}

export function useIsInsideFileViewerInset(): boolean {
  return React.useContext(FileViewerInsetContext);
}

export function useIsInsideFileViewerViewport(): boolean {
  return React.useContext(FileViewerViewportContext);
}

export type FileViewerContentProps = React.ComponentProps<"div">;
export type FileViewerInsetProps = React.ComponentProps<"div"> & {
  align?: FileViewerDocumentAlign;
  documentFrameClassName?: string;
  documentFrameStyle?: React.CSSProperties;
  maxInlineSize?: React.CSSProperties["maxInlineSize"];
};
export type FileViewerLegendProps = React.ComponentProps<"div">;
export type FileViewerViewportProps = React.ComponentProps<"div">;

export function FileViewerContent({
  className,
  ...props
}: FileViewerContentProps) {
  const shell = useFileViewerShellStatic("FileViewerContent");

  return (
    <FileViewerContentContext.Provider value={true}>
      <div
        data-file-viewer-sidebar-mode={shell.mode}
        data-file-viewer-sidebar-side={shell.side}
        data-slot="file-viewer-content"
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
          className,
        )}
        {...props}
      />
    </FileViewerContentContext.Provider>
  );
}

export function FileViewerLegend({
  className,
  ...props
}: FileViewerLegendProps) {
  return (
    <div
      data-slot="file-viewer-legend"
      className={cn("min-w-0 flex-shrink-0 border-b", className)}
      {...props}
    />
  );
}

export function FileViewerInset({
  align = "start",
  children,
  className,
  documentFrameClassName,
  documentFrameStyle,
  maxInlineSize,
  ...props
}: FileViewerInsetProps) {
  const shell = useOptionalFileViewerShellStatic();
  const hasAnimatedFileViewerWidth =
    shell?.mode === "inline" && shell.canToggleSidebar;
  const documentFrame = useMeasuredFileViewerDocumentFrame({
    enabled: !hasAnimatedFileViewerWidth,
  });
  const frame = React.useMemo<FileViewerDocumentFrameState>(
    () => ({
      align,
      element: documentFrame.element,
      inlineSize: documentFrame.inlineSize,
    }),
    [align, documentFrame.element, documentFrame.inlineSize],
  );

  return (
    <FileViewerInsetContext.Provider value={true}>
      <FileViewerDocumentFrameProvider value={frame}>
        <div
          data-slot="file-viewer-inset"
          className={cn(
            "relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            className,
          )}
          {...props}
        >
          <div
            ref={documentFrame.setElement}
            data-slot="file-viewer-document-frame"
            className={cn(
              "[container-type:inline-size] relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col",
              getDocumentFrameAlignClass(align),
              documentFrameClassName,
            )}
            style={
              {
                maxInlineSize,
                ...documentFrameStyle,
              } as React.CSSProperties
            }
          >
            {children}
          </div>
        </div>
      </FileViewerDocumentFrameProvider>
    </FileViewerInsetContext.Provider>
  );
}

export const FileViewerViewport = React.forwardRef<
  HTMLDivElement,
  FileViewerViewportProps
>(function FileViewerViewport({ className, style, ...props }, ref) {
  const isInsideInset = useIsInsideFileViewerInset();
  const setElement = React.useCallback(
    (element: HTMLDivElement | null) => {
      if (typeof ref === "function") {
        ref(element);
      } else if (ref) {
        ref.current = element;
      }
    },
    [ref],
  );

  if (process.env.NODE_ENV !== "production" && !isInsideInset) {
    throw new Error(
      "FileViewerViewport must be rendered inside FileViewerInset.",
    );
  }

  return (
    <FileViewerViewportContext.Provider value={true}>
      <div
        ref={setElement}
        data-slot="file-viewer-viewport"
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          className,
        )}
        style={
          {
            ...style,
          } as React.CSSProperties
        }
        {...props}
      />
    </FileViewerViewportContext.Provider>
  );
});

function useMeasuredFileViewerDocumentFrame({ enabled }: { enabled: boolean }) {
  const size = useStableElementSize<HTMLDivElement>({
    enabled,
  });

  return React.useMemo(
    () => ({
      element: size.element,
      inlineSize: size.width,
      setElement: size.setElement,
    }),
    [size.element, size.setElement, size.width],
  );
}

function getDocumentFrameAlignClass(align: FileViewerDocumentAlign) {
  switch (align) {
    case "center":
      return "mx-auto";
    case "end":
      return "ml-auto";
    case "start":
      return "mr-auto";
  }
}
