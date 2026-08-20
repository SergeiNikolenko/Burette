"use client";

import * as React from "react";

import {
  useOptionalFileViewerShell,
  useOptionalFileViewerShellStatic,
  useFileViewerShellStatic,
} from "./file-viewer-context";
import type { FileViewerDocumentSurface } from "./file-viewer-motion-kernel";
import {
  createFileViewerRendererFrame,
  type FileViewerDocumentAlign,
  type FileViewerRendererFrame,
} from "./file-viewer-renderer-contract";
import { useFileViewerMotionFrame } from "./file-viewer-motion-kernel";
import { useViewerInlineDirection } from "./viewer-measurement";

export type FileViewerRendererEnvironment = {
  registerDocumentSurface: (surface: FileViewerDocumentSurface) => () => void;
  usesShellGeometry: boolean;
};

export type FileViewerDocumentFrameState = {
  align: FileViewerDocumentAlign;
  element: HTMLDivElement | null;
  inlineSize: number | null;
};

const FileViewerDocumentFrameContext =
  React.createContext<FileViewerDocumentFrameState | null>(null);

export function FileViewerDocumentFrameProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: FileViewerDocumentFrameState;
}) {
  return (
    <FileViewerDocumentFrameContext.Provider value={value}>
      {children}
    </FileViewerDocumentFrameContext.Provider>
  );
}

export function useOptionalFileViewerDocumentFrame(): FileViewerDocumentFrameState | null {
  return React.useContext(FileViewerDocumentFrameContext);
}

export function useOptionalFileViewerRendererEnvironment(): FileViewerRendererEnvironment {
  const { elementRegistry, usesShellGeometry } =
    useFileViewerRendererEnvironmentState();
  const registerDocumentSurface = React.useCallback(
    (surface: FileViewerDocumentSurface) =>
      elementRegistry?.registerDocumentSurface(surface) ?? (() => {}),
    [elementRegistry],
  );

  return React.useMemo(
    () => ({
      registerDocumentSurface,
      usesShellGeometry,
    }),
    [registerDocumentSurface, usesShellGeometry],
  );
}

export type FileViewerSidebarMotion = {
  /** True when the shell animates the sidebar (inline mode with a toggle). */
  isMotionManaged: boolean;
  isSidebarInteractive: boolean;
  isSidebarOpen: boolean;
  isSidebarTransitioning: boolean;
};

export function useOptionalFileViewerSidebarMotion(): FileViewerSidebarMotion | null {
  const shell = useOptionalFileViewerShell();

  return React.useMemo(
    () =>
      shell
        ? {
            isMotionManaged: shell.mode === "inline" && shell.canToggleSidebar,
            isSidebarInteractive: shell.isSidebarInteractive,
            isSidebarOpen: shell.isSidebarOpen,
            isSidebarTransitioning: shell.isSidebarTransitioning,
          }
        : null,
    [shell],
  );
}

export function useFileViewerRendererFrame({
  fallbackInlineSize,
}: {
  fallbackInlineSize?: number | null;
} = {}): FileViewerRendererFrame {
  useFileViewerShellStatic("useFileViewerRendererFrame");
  return useResolvedFileViewerRendererFrame({
    fallbackInlineSize,
    required: true,
  });
}

export function useOptionalFileViewerRendererFrame({
  fallbackInlineSize,
}: {
  fallbackInlineSize?: number | null;
} = {}): FileViewerRendererFrame {
  return useResolvedFileViewerRendererFrame({
    fallbackInlineSize,
    required: false,
  });
}

function useResolvedFileViewerRendererFrame({
  fallbackInlineSize,
  required,
}: {
  fallbackInlineSize?: number | null;
  required: boolean;
}): FileViewerRendererFrame {
  const { motionFrame, shell, usesShellGeometry } =
    useFileViewerRendererEnvironmentState();
  const documentFrame = useOptionalFileViewerDocumentFrame();

  if (required && !documentFrame) {
    throw new Error(
      "useFileViewerRendererFrame must be used within FileViewerInset.",
    );
  }

  const fallbackSize =
    fallbackInlineSize != null && Number.isFinite(fallbackInlineSize)
      ? fallbackInlineSize
      : null;

  // The fit-width motion transform is a physical-X computation, so renderers
  // need the frame's computed CSS `direction` alongside its logical align.
  const direction = useViewerInlineDirection(documentFrame?.element ?? null);

  return React.useMemo(
    () =>
      createFileViewerRendererFrame({
        align: documentFrame?.align ?? "center",
        canToggleSidebar: shell?.canToggleSidebar ?? false,
        direction,
        element: documentFrame?.element ?? null,
        fallbackInlineSize: documentFrame?.inlineSize ?? fallbackSize,
        motionFrame,
        motionDurationMs: shell?.motionDurationMs ?? 0,
        usesShellGeometry,
      }),
    [
      direction,
      documentFrame?.align,
      documentFrame?.element,
      documentFrame?.inlineSize,
      fallbackSize,
      shell?.canToggleSidebar,
      motionFrame,
      shell?.motionDurationMs,
      usesShellGeometry,
    ],
  );
}

function useFileViewerRendererEnvironmentState() {
  const shell = useOptionalFileViewerShellStatic();
  const motionFrame = useFileViewerMotionFrame(shell?.motionKernel);
  const usesShellGeometry = Boolean(
    shell &&
      motionFrame.shellInlineSize > 0 &&
      shell.mode === "inline" &&
      (shell.canToggleSidebar || shell.collapsible === "none"),
  );

  return React.useMemo(
    () => ({
      elementRegistry: shell?.elementRegistry,
      motionFrame,
      shell,
      usesShellGeometry,
    }),
    [motionFrame, shell, usesShellGeometry],
  );
}
