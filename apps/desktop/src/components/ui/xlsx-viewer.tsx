"use client";

import * as React from "react";

import {
  createViewerResource,
  type ViewerResource,
} from "@/lib/viewer-resource";
import { useIsClient } from "@/components/ui/use-is-client";
import { ViewerErrorBoundary } from "@/components/ui/viewer-error";

import { XlsxViewerFallback } from "./xlsx-viewer-chrome";
import { XlsxViewerSession } from "./xlsx-viewer-session";
import type {
  XlsxResourceContentProps,
  XlsxViewerHandle,
  XlsxViewerProps,
} from "./xlsx-viewer-types";

export type {
  XlsxCellRef,
  XlsxDocumentSource,
  XlsxResourceContentProps,
  XlsxViewerHandle,
  XlsxViewerProps,
} from "./xlsx-viewer-types";

export type XlsxViewerProviderProps = {
  children: React.ReactNode;
  resource: ViewerResource;
};

export type XlsxViewerWorkbookProps = Omit<
  XlsxResourceContentProps,
  "resource"
>;

export const XlsxViewer = React.forwardRef<XlsxViewerHandle, XlsxViewerProps>(
  function XlsxViewer(props, ref) {
    const { source, ...resourceProps } = props;
    const resource = React.useMemo(
      () => createViewerResource(source),
      [source],
    );
    return (
      <XlsxResourceContent {...resourceProps} ref={ref} resource={resource} />
    );
  },
);

const XlsxViewerResourceContext = React.createContext<ViewerResource | null>(
  null,
);

export function XlsxViewerProvider({
  children,
  resource,
}: XlsxViewerProviderProps) {
  return (
    <XlsxViewerResourceContext.Provider value={resource}>
      {children}
    </XlsxViewerResourceContext.Provider>
  );
}

function useXlsxViewerResource(): ViewerResource {
  const resource = React.useContext(XlsxViewerResourceContext);
  if (!resource) {
    throw new Error(
      "XlsxViewerWorkbook must be used within XlsxViewerProvider.",
    );
  }
  return resource;
}

export const XlsxViewerWorkbook = React.forwardRef<
  XlsxViewerHandle,
  XlsxViewerWorkbookProps
>(function XlsxViewerWorkbook(props, ref) {
  const resource = useXlsxViewerResource();
  return <XlsxResourceContent {...props} ref={ref} resource={resource} />;
});

export const XlsxResourceContent = React.forwardRef<
  XlsxViewerHandle,
  XlsxResourceContentProps
>(function XlsxResourceContent(props, ref) {
  const isClient = useIsClient();
  const resource = props.resource;
  if (!isClient) {
    return (
      <XlsxViewerFallback
        className={props.className}
        fallbackSheetTabs={props.fallbackSheetTabs}
        controls={props.controls}
        bare={props.bare}
      />
    );
  }
  return (
    <ViewerErrorBoundary
      className={props.className}
      download={
        props.controls === false || props.download === false
          ? null
          : resource.originalDownload
      }
      format="xlsx"
      resetKey={resource.keys.resource}
      sourceKind={resource.sourceKind}
    >
      <React.Suspense
        fallback={
          <XlsxViewerFallback
            className={props.className}
            fallbackSheetTabs={props.fallbackSheetTabs}
            controls={props.controls}
            bare={props.bare}
          />
        }
      >
        <XlsxViewerSession
          key={resource.keys.resource}
          {...props}
          forwardedRef={ref}
          resource={resource}
        />
      </React.Suspense>
    </ViewerErrorBoundary>
  );
});
