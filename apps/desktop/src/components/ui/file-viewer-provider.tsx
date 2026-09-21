"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import { joinEffectKey } from "@/lib/effect-key";
import type { FileCategory, ViewerSource } from "@/lib/viewer-source";

import {
  FileViewerContext,
  type FileViewerContextValue,
  type FileViewerHeaderMode,
} from "./file-viewer-context";
import type { FileViewerFallbackSize } from "./file-viewer-core";
import {
  FileViewerResourceProvider,
  useFileViewerResourceState,
} from "./file-viewer-resource-state";
import {
  ViewerControlsRegistrationProvider,
  type ViewerControlsState,
} from "./viewer-controls";
import { warnViewerDevelopmentOnce } from "./viewer-diagnostics";
import {
  useViewerHeaderOutletAvailable,
  useViewerHeaderOutletsAvailable,
} from "./viewer-header-outlet";

export type FileViewerControlsState = ViewerControlsState;

type FileViewerControlsRegistration = {
  descriptorKey: string;
  state: FileViewerControlsState | null;
};

type FileViewerControlsValue = {
  controlsState: FileViewerControlsState | null;
};

const FileViewerControlsContext =
  React.createContext<FileViewerControlsValue | null>(null);

function useFileViewerControlsController(descriptorKey: string): {
  controlsValue: FileViewerControlsValue;
  handleControlsChange: (state: FileViewerControlsState | null) => void;
} {
  const [controlsRegistration, setControlsRegistration] =
    React.useState<FileViewerControlsRegistration>(() => ({
      descriptorKey,
      state: null,
    }));
  const controlsState =
    controlsRegistration.descriptorKey === descriptorKey
      ? controlsRegistration.state
      : null;
  const handleControlsChange = React.useCallback(
    (state: FileViewerControlsState | null) => {
      setControlsRegistration({ descriptorKey, state });
    },
    [descriptorKey],
  );
  const controlsValue = React.useMemo<FileViewerControlsValue>(
    () => ({
      controlsState,
    }),
    [controlsState],
  );

  return {
    controlsValue,
    handleControlsChange,
  };
}

export function useFileViewerControlsState() {
  const context = React.useContext(FileViewerControlsContext);
  if (!context) {
    throw new Error("File viewer controls must be used within FileViewer.");
  }
  return context.controlsState;
}

export type FileViewerProviderProps = {
  children: React.ReactNode;
  source: ViewerSource;
  category?: FileCategory;
  fallbackFrameSize?: FileViewerFallbackSize;
  fallbackSlideSize?: FileViewerFallbackSize;
  isolateStyles?: boolean;
  headerMode?: FileViewerHeaderMode;
  defaultSidebarOpen?: boolean;
  sidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
};

export function FileViewerProvider({
  children,
  source,
  category,
  fallbackFrameSize,
  fallbackSlideSize,
  isolateStyles,
  headerMode,
  defaultSidebarOpen,
  sidebarOpen,
  onSidebarOpenChange,
}: FileViewerProviderProps) {
  const diagnosticViewerId = React.useId();
  const resourceState = useFileViewerResourceState({
    category,
    fallbackFrameSize,
    fallbackSlideSize,
    isolateStyles,
    source,
  });
  const controlsController = useFileViewerControlsController(
    resourceState.descriptorKey,
  );
  const hasTitleGroupOutlet = useViewerHeaderOutletAvailable("titleGroup");
  const hasControlsOutlet = useViewerHeaderOutletAvailable("controls");
  const hasHeaderOutlets = useViewerHeaderOutletsAvailable();
  const resolvedHeaderMode = headerMode ?? "inline";
  const contextValue = React.useMemo<FileViewerContextValue>(
    () => ({
      headerMode: resolvedHeaderMode,
      hasHeaderOutlets: resolvedHeaderMode === "outlets" && hasHeaderOutlets,
      isInsideFileViewer: true,
      resourceCategory: resourceState.descriptor.category,
      sidebarOpenProps: {
        defaultOpen: defaultSidebarOpen,
        onOpenChange: onSidebarOpenChange,
        open: sidebarOpen,
      },
    }),
    [
      defaultSidebarOpen,
      hasHeaderOutlets,
      onSidebarOpenChange,
      resolvedHeaderMode,
      resourceState.descriptor.category,
      sidebarOpen,
    ],
  );
  const hasExactlyOneHeaderOutlet =
    resolvedHeaderMode === "outlets" &&
    hasTitleGroupOutlet !== hasControlsOutlet;

  useKeyedMountEffect(
    hasExactlyOneHeaderOutlet
      ? joinEffectKey([
          "file-viewer-header-outlet-single-mount",
          diagnosticViewerId,
          hasTitleGroupOutlet,
          hasControlsOutlet,
        ])
      : null,
    () => {
      warnViewerDevelopmentOnce({
        code: "file_viewer_header_outlet_single_mount",
        message: "file viewer has exactly one header outlet mounted.",
        rootId: diagnosticViewerId,
        details: {
          controlsOutletAvailable: hasControlsOutlet,
          titleGroupOutletAvailable: hasTitleGroupOutlet,
        },
      });
    },
  );

  return (
    <FileViewerResourceProvider value={resourceState}>
      <FileViewerControlsContext.Provider
        value={controlsController.controlsValue}
      >
        <ViewerControlsRegistrationProvider
          onControlsChange={controlsController.handleControlsChange}
        >
          <FileViewerContext.Provider value={contextValue}>
            {children}
          </FileViewerContext.Provider>
        </ViewerControlsRegistrationProvider>
      </FileViewerControlsContext.Provider>
    </FileViewerResourceProvider>
  );
}
