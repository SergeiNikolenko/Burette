"use client";

import * as React from "react";

import { inferCsvDialect, parseCsv } from "@/lib/csv";
import type { ViewerResource } from "@/lib/viewer-resource";
import { GridTable } from "@/components/file-thumbnail/renderers/layout";
import {
  CSV_THUMBNAIL_MAX_COLUMNS,
  CSV_THUMBNAIL_MAX_ROWS,
} from "@/components/file-thumbnail/thumbnail-limits";
import { useThumbnailResource } from "@/components/file-thumbnail/thumbnail-resource";
import {
  getThumbnailText,
  thumbnailFileMeta,
} from "@/components/file-thumbnail/thumbnail-text";

export function CsvFirstRows({
  resource,
  thumbnailKey,
}: {
  resource: ViewerResource;
  thumbnailKey: string;
}) {
  const raw = useThumbnailResource(
    getThumbnailText(
      thumbnailFileMeta(resource),
      resource.content,
      thumbnailKey,
    ),
  );
  const rows = React.useMemo(() => {
    const dialect = inferCsvDialect({
      fileName: resource.fileName,
      mimeType: resource.mimeType,
    });
    const table = parseCsv(raw, dialect);
    const header = table.columns.length
      ? [table.columns.slice(0, CSV_THUMBNAIL_MAX_COLUMNS)]
      : [];
    return header.concat(
      table.rows
        .slice(0, CSV_THUMBNAIL_MAX_ROWS - header.length)
        .map((row) => row.slice(0, CSV_THUMBNAIL_MAX_COLUMNS)),
    );
  }, [raw, resource.fileName, resource.mimeType]);
  return <GridTable rows={rows} headerRow />;
}
