"use client";

import * as React from "react";

import { useKeyedLayoutEffect } from "@/hooks/use-keyed-layout-effect";
import { joinEffectKey } from "@/lib/effect-key";
import {
  fileViewerDiagnostic,
  nextFileViewerSessionId,
  summarizeDiagnosticId,
  summarizeViewerDescriptor,
  summarizeViewerResource,
} from "@/lib/pdf-viewer-diagnostics";
import {
  createViewerResource,
  type ViewerResource,
} from "@/lib/viewer-resource";

import {
  descriptorResetKey,
  type FileDescriptor,
  type FileViewerFallbackSize,
  type FileViewerCoreProps,
} from "./file-viewer-core";
import { useIsClient } from "./use-is-client";

export type FileViewerResourceOptions = Pick<
  FileViewerCoreProps,
  | "category"
  | "fallbackFrameSize"
  | "fallbackSlideSize"
  | "isolateStyles"
  | "source"
>;

export type FileViewerResourceState = {
  descriptor: FileDescriptor;
  descriptorKey: string;
  descriptorSignal: AbortSignal;
  fallbackFrameSize?: FileViewerFallbackSize;
  fallbackSlideSize?: FileViewerFallbackSize;
  isClient: boolean;
  isolateStyles: boolean;
  resource: ViewerResource;
};

const FileViewerResourceContext =
  React.createContext<FileViewerResourceState | null>(null);

// Per-descriptor cancellation signal. Aborting is deferred a macrotask so a
// keyed remount can keep reusing a shared resource request through React
// StrictMode's mount/unmount/mount sequence.
function useDescriptorSignal(descriptorKey: string): AbortSignal {
  const controller = React.useMemo(() => {
    void descriptorKey;
    return new AbortController();
  }, [descriptorKey]);
  const abortTimerRef = React.useRef<{
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  useKeyedLayoutEffect(joinEffectKey([controller]), () => {
    const descriptorKeyHash = summarizeDiagnosticId(descriptorKey);
    fileViewerDiagnostic("debug", "file_viewer_descriptor_signal_active", {
      descriptorKeyHash,
    });
    if (abortTimerRef.current?.controller === controller) {
      clearTimeout(abortTimerRef.current.timer);
      abortTimerRef.current = null;
      fileViewerDiagnostic(
        "debug",
        "file_viewer_descriptor_signal_abort_cancelled",
        { descriptorKeyHash },
      );
    }

    return () => {
      fileViewerDiagnostic("debug", "file_viewer_descriptor_abort_scheduled", {
        descriptorKeyHash,
        isSignalAborted: controller.signal.aborted,
      });
      const abortTimer = {
        controller,
        timer: setTimeout(() => {
          fileViewerDiagnostic("debug", "file_viewer_descriptor_abort_fired", {
            descriptorKeyHash,
            isSignalAborted: controller.signal.aborted,
          });
          controller.abort();
          if (abortTimerRef.current === abortTimer) {
            abortTimerRef.current = null;
          }
        }, 0),
      };
      abortTimerRef.current = abortTimer;
    };
  });

  return controller.signal;
}

export function useFileViewerResourceState({
  category,
  fallbackFrameSize,
  fallbackSlideSize,
  isolateStyles = false,
  source,
}: FileViewerResourceOptions): FileViewerResourceState {
  const isClient = useIsClient();
  const resource = React.useMemo(
    () => createViewerResource(source, category),
    [source, category],
  );
  const descriptor = resource.descriptor;
  const descriptorKey = descriptorResetKey(descriptor);
  const viewerSessionId = React.useMemo(() => {
    void descriptorKey;
    return nextFileViewerSessionId("fv");
  }, [descriptorKey]);
  const descriptorSignal = useDescriptorSignal(descriptorKey);

  useKeyedLayoutEffect(joinEffectKey([descriptorKey, viewerSessionId]), () => {
    fileViewerDiagnostic("info", "file_viewer_resource_mount", {
      descriptor: summarizeViewerDescriptor(descriptor),
      descriptorKeyHash: summarizeDiagnosticId(descriptorKey),
      isClient,
      isolateStyles,
      resource: summarizeViewerResource(resource),
      viewerSessionId,
    });
    return () => {
      fileViewerDiagnostic("debug", "file_viewer_resource_unmount", {
        descriptor: summarizeViewerDescriptor(descriptor),
        descriptorKeyHash: summarizeDiagnosticId(descriptorKey),
        resource: summarizeViewerResource(resource),
        viewerSessionId,
      });
    };
  });

  return React.useMemo<FileViewerResourceState>(
    () => ({
      descriptor,
      descriptorKey,
      descriptorSignal,
      fallbackFrameSize,
      fallbackSlideSize,
      isClient,
      isolateStyles,
      resource,
    }),
    [
      descriptor,
      descriptorKey,
      descriptorSignal,
      fallbackFrameSize,
      fallbackSlideSize,
      isClient,
      isolateStyles,
      resource,
    ],
  );
}

export function FileViewerResourceProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: FileViewerResourceState;
}) {
  return React.createElement(
    FileViewerResourceContext.Provider,
    { value },
    children,
  );
}

export function useFileViewerRequiredResourceState(): FileViewerResourceState {
  const context = React.useContext(FileViewerResourceContext);
  if (!context) {
    throw new Error("File viewer parts must be used within FileViewer.");
  }
  return context;
}

export function useOptionalFileViewerResource(): ViewerResource | null {
  return React.useContext(FileViewerResourceContext)?.resource ?? null;
}

export function useFileViewerResource(): ViewerResource {
  const resource = useOptionalFileViewerResource();
  if (!resource) {
    throw new Error("useFileViewerResource must be used within FileViewer.");
  }
  return resource;
}
