"use client";

import * as React from "react";

import { useKeyedMountEffect } from "@/hooks/use-keyed-mount-effect";
import type { CsvDialect, CsvTable } from "@/lib/csv";
import {
  createViewerResource,
  type ViewerResource,
} from "@/lib/viewer-resource";

import {
  CsvViewerFrame,
  CsvViewerHeader,
  csvViewerStatusNode,
} from "./csv-viewer-chrome";
import {
  csvViewerDownloadActions,
  defaultCsvDownloadName,
} from "./csv-viewer-download";
import { CsvGrid, type CsvGridHandle } from "./csv-viewer-grid";
import {
  csvViewerExportFileName,
  csvViewerSortResetKey,
  isCsvDocumentSource,
  resolveCsvViewerDialect,
  type CsvDocumentSource,
  type CsvTableSource,
  type CsvViewerSource,
} from "./csv-viewer-resource";
import { useCsvResourceState, type CsvCellAddress } from "./csv-viewer-state";
import type { CsvViewerHandle, CsvViewerProps } from "./csv-viewer-types";
import {
  useViewerControlsRegistration,
  type ViewerControlsState,
} from "./viewer-controls";
import { joinEffectKey } from "@/lib/effect-key";

export type {
  CsvScrollOptions,
  CsvViewerHandle,
  CsvViewerProps,
} from "./csv-viewer-types";

export type CsvResourceContentProps = Omit<CsvViewerProps, "source"> & {
  resource?: ViewerResource | null;
  source?: CsvViewerSource;
};
type CsvResourceContentInternalProps = CsvResourceContentProps & {
  frame?: boolean;
};

export type CsvViewerProviderProps = {
  children: React.ReactNode;
  resource: ViewerResource;
};

export type CsvViewerGridProps = Omit<CsvResourceContentProps, "resource">;

export const CsvViewer = React.forwardRef<CsvViewerHandle, CsvViewerProps>(
  function CsvViewer({ source, ...props }, ref) {
    const resource = React.useMemo<ViewerResource | null>(
      () =>
        source && isCsvDocumentSource(source)
          ? createViewerResource(source)
          : null,
      [source],
    );
    return (
      <CsvResourceContent
        {...props}
        frame
        ref={ref}
        resource={resource}
        source={source}
      />
    );
  },
);

const CsvViewerResourceContext = React.createContext<ViewerResource | null>(
  null,
);

export function CsvViewerProvider({
  children,
  resource,
}: CsvViewerProviderProps) {
  return (
    <CsvViewerResourceContext.Provider value={resource}>
      {children}
    </CsvViewerResourceContext.Provider>
  );
}

function useCsvViewerResource(): ViewerResource {
  const resource = React.useContext(CsvViewerResourceContext);
  if (!resource) {
    throw new Error("CsvViewerGrid must be used within CsvViewerProvider.");
  }
  return resource;
}

export const CsvViewerDocument = React.forwardRef<
  CsvViewerHandle,
  CsvViewerProps
>(function CsvViewerDocument({ source, ...props }, ref) {
  const resource = React.useMemo<ViewerResource | null>(
    () =>
      source && isCsvDocumentSource(source)
        ? createViewerResource(source)
        : null,
    [source],
  );
  return (
    <CsvResourceContent
      {...props}
      frame={false}
      ref={ref}
      resource={resource}
      source={source}
    />
  );
});

export const CsvViewerGrid = React.forwardRef<
  CsvViewerHandle,
  CsvViewerGridProps
>(function CsvViewerGrid(props, ref) {
  const resource = useCsvViewerResource();
  return (
    <CsvResourceContent
      {...props}
      frame={false}
      ref={ref}
      resource={resource}
    />
  );
});

export const CsvResourceContent = React.forwardRef<
  CsvViewerHandle,
  CsvResourceContentInternalProps
>(function CsvResourceContent(
  {
    source,
    resource = null,
    dialect: dialectProp,
    className,
    controls = true,
    height = 480,
    fillHeight = false,
    frame = true,
    activeCell,
    isolateStyles = false,
  },
  ref,
) {
  const [retryVersion, setRetryVersion] = React.useState(0);
  const dialect = React.useMemo(
    () =>
      resolveCsvViewerDialect({
        dialect: dialectProp,
        source,
        resource,
      }),
    [dialectProp, source, resource],
  );
  const resourceState = useCsvResourceState({
    source,
    resource,
    dialect,
    retryVersion,
  });
  const gridRef = React.useRef<CsvGridHandle>(null);
  const [zoom, setZoom] = React.useState(1);
  const columns = resourceState.columns;
  const sourceRows = resourceState.sourceRows;
  const rowStore = resourceState.rowStore;
  const rowCount = rowStore.rowCount;
  const canExportTable =
    resourceState.status === "ready" || resourceState.status === "empty";
  const sortResetKey = csvViewerSortResetKey({
    dialect,
    source,
    resource,
  });
  const exportFileName = csvViewerExportFileName({
    dialect,
    source,
    resource,
    fallback: defaultCsvDownloadName,
  });
  const downloadActions = React.useMemo(() => {
    return csvViewerDownloadActions({
      resource,
      columns,
      sourceRows,
      dialect,
      fileName: exportFileName,
      canExportTable,
    });
  }, [canExportTable, columns, dialect, exportFileName, resource, sourceRows]);

  React.useImperativeHandle(
    ref ?? null,
    () => ({
      scrollToCell: (cellAddress, options) => {
        gridRef.current?.scrollToCell(cellAddress, options);
      },
      getViewportElement: () => gridRef.current?.getViewportElement() ?? null,
    }),
    [],
  );

  const statusNode = React.useMemo(
    () =>
      csvViewerStatusNode({
        resourceState,
        resource,
        rowCount,
        showDownload: controls,
        onRetry: () => setRetryVersion((version) => version + 1),
      }),
    [controls, resource, resourceState, rowCount],
  );
  const zoomOut = React.useCallback(
    () => setZoom((value) => clampCsvViewerZoom(value / 1.2)),
    [],
  );
  const zoomIn = React.useCallback(
    () => setZoom((value) => clampCsvViewerZoom(value * 1.2)),
    [],
  );
  const resetZoom = React.useCallback(() => setZoom(1), []);
  useCsvControlsRegistration({
    columnCount: columns.length,
    downloadActions,
    isLoading: resourceState.status === "loading",
    onResetZoom: resetZoom,
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    rowCount,
    zoom,
  });

  return (
    <CsvViewerFrame
      className={className}
      fillHeight={fillHeight}
      frame={frame}
      zoom={zoom}
    >
      <CsvViewerHeader
        controls={controls}
        rowCount={rowCount}
        columnCount={columns.length}
        isLoading={resourceState.status === "loading"}
        zoom={zoom}
        onZoomChange={setZoom}
        downloadActions={downloadActions}
      />
      <CsvGrid
        ref={gridRef}
        columns={columns}
        rowStore={rowStore}
        activeCell={activeCell ?? null}
        height={height}
        fillHeight={fillHeight}
        isolateStyles={isolateStyles}
        scale={zoom}
        sortResetKey={sortResetKey}
        statusNode={statusNode}
      />
    </CsvViewerFrame>
  );
});

export {
  type CsvCellAddress,
  type CsvDialect,
  type CsvDocumentSource,
  type CsvTableSource,
  type CsvTable,
  type CsvViewerSource,
};

function useCsvControlsRegistration({
  columnCount,
  downloadActions,
  isLoading,
  onResetZoom,
  onZoomIn,
  onZoomOut,
  rowCount,
  zoom,
}: {
  columnCount: number;
  downloadActions: ViewerControlsState["downloads"];
  isLoading: boolean;
  onResetZoom: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  rowCount: number;
  zoom: number;
}) {
  const onControlsChange = useViewerControlsRegistration();
  const rowLabel = `${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"}`;
  const columnLabel = `${columnCount} column${columnCount === 1 ? "" : "s"}`;
  const controlsState = React.useMemo<ViewerControlsState>(
    () => ({
      title: isLoading ? `${rowLabel} loading` : rowLabel,
      subtitle: isLoading ? null : columnLabel,
      loading: isLoading,
      zoom: {
        scale: zoom,
        onZoomOut,
        onZoomIn,
        onFit: onResetZoom,
        fitLabel: "Reset zoom",
      },
      downloads: downloadActions,
    }),
    [
      columnLabel,
      downloadActions,
      isLoading,
      onResetZoom,
      onZoomIn,
      onZoomOut,
      rowLabel,
      zoom,
    ],
  );

  useKeyedMountEffect(
    joinEffectKey(["csv-controls", onControlsChange, controlsState]),
    () => {
      if (!onControlsChange) return;
      onControlsChange(controlsState);
      return () => onControlsChange(null);
    },
  );
}

function clampCsvViewerZoom(zoom: number) {
  return Math.max(0.1, Math.min(5, zoom));
}
