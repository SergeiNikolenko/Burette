import type * as PptxNS from "pptxviewjs";

import {
  isViewerFormatError,
  ViewerFormatError,
  type ViewerFormatErrorKind,
  type ViewerFormatErrorMapperOptions,
} from "@/lib/viewer-errors";
import { type ViewerContentBytes } from "@/lib/viewer-resource";

import {
  DEFAULT_PPTX_SLIDE_SIZE,
  type PptxSize,
  type PptxSourceLoadTiming,
} from "./pptx-viewer-core";

type PptxModule = typeof PptxNS;

export type PptxRendererErrorKind = ViewerFormatErrorKind;

export class PptxRendererError extends ViewerFormatError {
  override readonly kind: PptxRendererErrorKind;

  constructor(kind: PptxRendererErrorKind, message: string, cause?: unknown) {
    super({ format: "pptx", kind, message, cause });
    this.name = "PptxRendererError";
    this.kind = kind;
  }
}

export interface PptxRenderInput {
  slideIndex: number;
  canvas: HTMLCanvasElement;
  renderScale: number;
}

export interface PptxRenderer {
  slideCount: number;
  baseSize: PptxSize;
  renderSlide(input: PptxRenderInput): Promise<void>;
  dispose(): void;
}

let pptxModulePromise: Promise<PptxModule> | null = null;

function loadPptx(): Promise<PptxModule> {
  if (!pptxModulePromise) pptxModulePromise = import("pptxviewjs");
  return pptxModulePromise;
}

export async function createPptxRenderer(
  content: ViewerContentBytes,
  onLoadTiming?: (timing: PptxSourceLoadTiming) => void,
): Promise<PptxRenderer> {
  const totalStartedAt = now();
  const readBytesStartedAt = now();
  const buffer = await readPptxBytes(content);
  const readBytesMs = now() - readBytesStartedAt;

  const importPptxStartedAt = now();
  const pptxPromise = loadPptx().then((pptx) => ({
    pptx,
    durationMs: now() - importPptxStartedAt,
  }));
  const pptx = await pptxPromise;
  const { PPTXViewer } = pptx.pptx;
  const offscreen = document.createElement("canvas");
  const viewer = new PPTXViewer({
    canvas: offscreen,
    slideSizeMode: "actual",
    autoExposeGlobals: false,
    autoChartRerenderDelayMs: 0,
    enableThumbnails: false,
  });
  const loadedViewer = viewer as unknown as LoadedPptxViewer;

  const loadFileStartedAt = now();
  try {
    await viewer.loadFile(buffer);
  } catch (error) {
    viewer.destroy?.();
    throw toPptxFormatError(error, {
      kind: "load_failed",
      message: "Failed to parse presentation.",
    });
  }
  const loadFileMs = now() - loadFileStartedAt;

  const readSlideSizeStartedAt = now();
  const baseSize = readLoadedSlideSize(loadedViewer);
  const readSlideSizeMs = now() - readSlideSizeStartedAt;

  let slideCount: number;
  const inspectStartedAt = now();
  try {
    slideCount = viewer.getSlideCount();
  } catch (error) {
    viewer.destroy?.();
    throw toPptxFormatError(error, {
      kind: "load_failed",
      message: "Failed to inspect presentation slides.",
    });
  }
  const inspectMs = now() - inspectStartedAt;
  if (!Number.isInteger(slideCount) || slideCount <= 0) {
    viewer.destroy?.();
    throw new PptxRendererError(
      "load_failed",
      "Presentation does not contain any slides.",
    );
  }

  onLoadTiming?.({
    byteLength: buffer.byteLength,
    importPptxMs: pptx.durationMs,
    inspectMs,
    loadFileMs,
    readBytesMs,
    readSlideSizeMs,
    slideCount,
    totalMs: now() - totalStartedAt,
  });

  let disposed = false;

  return {
    slideCount,
    baseSize,
    async renderSlide({ slideIndex, canvas, renderScale }) {
      if (disposed) {
        throw new PptxRendererError(
          "disposed",
          "Presentation renderer was disposed.",
        );
      }
      if (!isValidSlideIndex(slideIndex, slideCount)) {
        throw new PptxRendererError(
          "index_out_of_range",
          `Slide ${slideIndex + 1} is outside the presentation.`,
        );
      }
      if (!isValidRenderScale(renderScale)) {
        throw new PptxRendererError(
          "bounds",
          "Render scale must be a positive finite number.",
        );
      }
      try {
        setPptxRenderPixelRatio(loadedViewer, canvas, baseSize, renderScale);
        await viewer.renderSlide(slideIndex, canvas, {
          scale: renderScale,
          quality: "high",
        });
      } catch (error) {
        throw toPptxFormatError(error, {
          kind: "render_failed",
          message: `Failed to render slide ${slideIndex + 1}.`,
        });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      viewer.destroy?.();
    },
  };
}

function toPptxFormatError(
  error: unknown,
  options: ViewerFormatErrorMapperOptions,
): PptxRendererError {
  if (error instanceof PptxRendererError) return error;
  if (isViewerFormatError(error)) {
    return new PptxRendererError(error.kind, error.message, error.cause);
  }
  return new PptxRendererError(options.kind, options.message, error);
}

function readPptxBytes(content: ViewerContentBytes): Promise<ArrayBuffer> {
  return content.readBytes();
}

type LoadedPptxViewer = {
  getSlideDimensions?: () => unknown;
  processor?: unknown;
  presentation?: unknown;
};

type LoadedPptxProcessor = {
  getSlideDimensions?: () => unknown;
  processor?: unknown;
  presentation?: unknown;
  renderContext?: {
    pixelRatio?: number;
    dpi?: number;
  };
  setPixelRatio?: (ratio: number) => void;
};

function readLoadedSlideSize(viewer: LoadedPptxViewer): PptxSize {
  return (
    parseLoadedSlideSize(readLoadedSlideDimensions(viewer)) ??
    DEFAULT_PPTX_SLIDE_SIZE
  );
}

function readLoadedSlideDimensions(viewer: LoadedPptxViewer): unknown {
  try {
    const dimensions = viewer.getSlideDimensions?.();
    if (dimensions) return dimensions;
  } catch {
    /* fall through to exposed presentation objects */
  }

  const processor = viewer.processor as LoadedPptxProcessor | undefined;
  try {
    const dimensions = processor?.getSlideDimensions?.();
    if (dimensions) return dimensions;
  } catch {
    /* fall through to presentation fields */
  }

  return (
    readPresentationSlideSize(viewer.presentation) ??
    readPresentationSlideSize(processor?.presentation) ??
    readPresentationSlideSize(
      (processor?.processor as LoadedPptxProcessor | undefined)?.presentation,
    )
  );
}

function readPresentationSlideSize(presentation: unknown): unknown {
  if (!presentation || typeof presentation !== "object") return null;
  const slideSize = (presentation as { slideSize?: unknown }).slideSize;
  return slideSize ?? null;
}

function parseLoadedSlideSize(value: unknown): PptxSize | null {
  if (!value || typeof value !== "object") return null;
  const { cx, cy } = value as { cx?: unknown; cy?: unknown };
  const widthEmu = Number(cx);
  const heightEmu = Number(cy);
  if (
    !Number.isFinite(widthEmu) ||
    !Number.isFinite(heightEmu) ||
    widthEmu <= 0 ||
    heightEmu <= 0
  ) {
    return null;
  }

  const width = Math.round(widthEmu / 9525);
  const height = Math.round(heightEmu / 9525);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function setPptxRenderPixelRatio(
  viewer: LoadedPptxViewer,
  canvas: HTMLCanvasElement,
  baseSize: PptxSize,
  renderScale: number,
) {
  const logicalWidth = Number.parseFloat(canvas.style.width);
  const zoomScale =
    Number.isFinite(logicalWidth) && logicalWidth > 0 && baseSize.width > 0
      ? logicalWidth / baseSize.width
      : 1;
  const pixelRatio = renderScale / zoomScale;
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) return;

  const processor = viewer.processor as LoadedPptxProcessor | undefined;
  const innerProcessor = processor?.processor as
    | LoadedPptxProcessor
    | undefined;
  setProcessorPixelRatio(processor, pixelRatio);
  setProcessorPixelRatio(innerProcessor, pixelRatio);
}

function setProcessorPixelRatio(
  processor: LoadedPptxProcessor | undefined,
  pixelRatio: number,
) {
  if (!processor) return;
  if (typeof processor.setPixelRatio === "function") {
    try {
      processor.setPixelRatio(pixelRatio);
      return;
    } catch {
      /* fall through to direct renderContext patching */
    }
  }
  if (!processor.renderContext) return;
  processor.renderContext.pixelRatio = pixelRatio;
  processor.renderContext.dpi = pixelRatio * 96;
}

function isValidSlideIndex(slideIndex: number, slideCount: number) {
  return (
    Number.isInteger(slideIndex) && slideIndex >= 0 && slideIndex < slideCount
  );
}

function isValidRenderScale(renderScale: number) {
  return Number.isFinite(renderScale) && renderScale > 0;
}

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function resetPptxRendererModules() {
  pptxModulePromise = null;
}

export function preloadPptxRenderer() {
  void loadPptx();
}
