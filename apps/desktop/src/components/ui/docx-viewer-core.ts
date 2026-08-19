import type * as DocxPreview from "docx-preview";

import {
  isViewerFormatError,
  ViewerFormatError,
  type ViewerFormatErrorMapperOptions,
} from "@/lib/viewer-errors";

export const DOCX_MIN_SCALE = 0.1;
export const DOCX_MAX_SCALE = 5;
export const DOCX_ZOOM_STEP = 1.2;

export const DEFAULT_DOCX_PAGE_WIDTH = 816;
export const DEFAULT_DOCX_PAGE_HEIGHT = 1056;

export const DOCX_RENDER_OPTIONS: Partial<DocxPreview.Options> = {
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: false,
  experimental: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
};

export const DOCX_SCOPED_STYLES = `
[data-slot="docx-viewer"] .docx-wrapper {
  background: transparent;
  padding: 0;
  gap: 1rem;
}
[data-slot="docx-viewer"] .docx-wrapper > section.docx {
  margin-bottom: 0;
  box-shadow: 0 0 0 1px var(--border), 0 1px 2px 0 rgb(0 0 0 / 0.05);
}`;

export function clampDocxScale(value: number) {
  return clamp(value, DOCX_MIN_SCALE, DOCX_MAX_SCALE);
}

export function normalizeDocxScale(value: number | null | undefined) {
  if (value == null) return null;
  if (Number.isNaN(value)) return 1;
  return clampDocxScale(value);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function positivePixel(value: number) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function toDocxFormatError(
  error: unknown,
  options: ViewerFormatErrorMapperOptions,
): ViewerFormatError {
  if (isViewerFormatError(error)) return error;
  return new ViewerFormatError({
    format: "docx",
    kind: options.kind,
    message: options.message,
    cause: error,
  });
}
