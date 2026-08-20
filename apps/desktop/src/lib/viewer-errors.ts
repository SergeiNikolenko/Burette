export type ViewerFormat =
  | "pdf"
  | "image"
  | "text"
  | "csv"
  | "docx"
  | "xlsx"
  | "pptx"
  | "file";

export type ViewerErrorDomain =
  | "resource"
  | "format"
  | "state"
  | "unsupported"
  | "unknown";

export type ResourceErrorKind =
  | "fetch_failed"
  | "http_error"
  | "aborted"
  | "invalid_range"
  | "partial_content"
  | "too_large"
  | "unsupported_capability"
  | "unknown";

export type ResourceTooLargeReason = "bytes" | "lines";

export class ResourceError extends Error {
  readonly domain = "resource";
  readonly kind: ResourceErrorKind;
  readonly status?: number;
  readonly tooLargeReason?: ResourceTooLargeReason;
  override readonly cause?: unknown;

  constructor({
    kind,
    message,
    status,
    tooLargeReason,
    cause,
  }: {
    kind: ResourceErrorKind;
    message: string;
    status?: number;
    tooLargeReason?: ResourceTooLargeReason;
    cause?: unknown;
  }) {
    super(message);
    this.name = "ResourceError";
    this.kind = kind;
    this.status = status;
    this.tooLargeReason = tooLargeReason;
    this.cause = cause;
  }
}

export type ViewerFormatErrorKind =
  | "bounds"
  | "decode_failed"
  | "disposed"
  | "index_out_of_range"
  | "load_failed"
  | "parse_failed"
  | "render_failed"
  | "worker_failed"
  | "unknown";

export interface ViewerFormatErrorMapperOptions {
  kind: ViewerFormatErrorKind;
  message: string;
}

export class ViewerFormatError extends Error {
  readonly domain = "format";
  readonly format: ViewerFormat;
  readonly kind: ViewerFormatErrorKind;
  override readonly cause?: unknown;

  constructor({
    format,
    kind,
    message,
    cause,
  }: {
    format: ViewerFormat;
    kind: ViewerFormatErrorKind;
    message: string;
    cause?: unknown;
  }) {
    super(message);
    this.name = "ViewerFormatError";
    this.format = format;
    this.kind = kind;
    this.cause = cause;
  }
}

export type ViewerStateErrorKind =
  | "invalid_bounds"
  | "invalid_target"
  | "out_of_range"
  | "stale_resource"
  | "unknown";

export class ViewerStateError extends Error {
  readonly domain = "state";
  readonly format?: ViewerFormat;
  readonly kind: ViewerStateErrorKind;
  override readonly cause?: unknown;

  constructor({
    format,
    kind,
    message,
    cause,
  }: {
    format?: ViewerFormat;
    kind: ViewerStateErrorKind;
    message: string;
    cause?: unknown;
  }) {
    super(message);
    this.name = "ViewerStateError";
    this.format = format;
    this.kind = kind;
    this.cause = cause;
  }
}

export class ViewerUnsupportedError extends Error {
  readonly domain = "unsupported";
  readonly format?: ViewerFormat;
  readonly sourceKind?: string;
  override readonly cause?: unknown;

  constructor({
    format,
    sourceKind,
    message,
    cause,
  }: {
    format?: ViewerFormat;
    sourceKind?: string;
    message: string;
    cause?: unknown;
  }) {
    super(message);
    this.name = "ViewerUnsupportedError";
    this.format = format;
    this.sourceKind = sourceKind;
    this.cause = cause;
  }
}

export interface ViewerErrorInfo {
  domain: ViewerErrorDomain;
  format?: ViewerFormat;
  kind: string;
  message: string;
  status?: number;
  isRetryable: boolean;
  isDownloadUseful: boolean;
  userMessage: string;
  cause?: unknown;
}

export interface ViewerErrorContext {
  format?: ViewerFormat;
  sourceKind?: "url" | "blob" | "text";
  canDownload?: boolean;
  retry?: "auto" | "always" | "never";
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function isResourceError(error: unknown): error is ResourceError {
  return (
    error instanceof ResourceError ||
    isErrorLike(error, "ResourceError", "resource")
  );
}

export function isViewerFormatError(
  error: unknown,
): error is ViewerFormatError {
  return (
    error instanceof ViewerFormatError ||
    isErrorLike(error, "ViewerFormatError", "format")
  );
}

export function isViewerStateError(error: unknown): error is ViewerStateError {
  return (
    error instanceof ViewerStateError ||
    isErrorLike(error, "ViewerStateError", "state")
  );
}

export function isViewerUnsupportedError(
  error: unknown,
): error is ViewerUnsupportedError {
  return (
    error instanceof ViewerUnsupportedError ||
    isErrorLike(error, "ViewerUnsupportedError", "unsupported")
  );
}

export function toViewerErrorInfo(
  error: unknown,
  context: ViewerErrorContext = {},
): ViewerErrorInfo {
  const canDownload = context.canDownload ?? true;

  if (isResourceError(error)) {
    return {
      domain: "resource",
      format: context.format,
      kind: error.kind,
      message: error.message,
      status: error.status,
      isRetryable: retryable(
        context,
        resourceErrorDefaultRetry(error, context),
      ),
      isDownloadUseful: canDownload && error.kind !== "aborted",
      userMessage: resourceErrorUserMessage(error),
      cause: error.cause,
    };
  }

  if (isViewerFormatError(error)) {
    const format = error.format ?? context.format;
    return {
      domain: "format",
      format,
      kind: error.kind,
      message: error.message,
      isRetryable: retryable(
        context,
        formatErrorDefaultRetry(error, context, format),
      ),
      isDownloadUseful: canDownload,
      userMessage: formatErrorUserMessage(format, error.kind, error),
      cause: error.cause,
    };
  }

  if (isViewerStateError(error)) {
    return {
      domain: "state",
      format: error.format ?? context.format,
      kind: error.kind,
      message: error.message,
      isRetryable: retryable(context, false),
      isDownloadUseful: canDownload,
      userMessage: stateErrorUserMessage(error.kind),
      cause: error.cause,
    };
  }

  if (isViewerUnsupportedError(error)) {
    return {
      domain: "unsupported",
      format: error.format ?? context.format,
      kind: "unsupported",
      message: error.message,
      isRetryable: retryable(context, false),
      isDownloadUseful: canDownload,
      userMessage: "This file cannot be previewed here.",
      cause: error.cause,
    };
  }

  if (isAbortError(error)) {
    return {
      domain: "resource",
      format: context.format,
      kind: "aborted",
      message: "Loading was cancelled.",
      isRetryable: retryable(context, false),
      isDownloadUseful: false,
      userMessage: "Loading was cancelled.",
      cause: error,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    domain: "unknown",
    format: context.format,
    kind: "unknown",
    message,
    isRetryable: retryable(context, unknownErrorDefaultRetry(context)),
    isDownloadUseful: canDownload,
    userMessage: fallbackUserMessage(context.format),
    cause: error,
  };
}

function isErrorLike(error: unknown, name: string, domain: ViewerErrorDomain) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    domain?: unknown;
    kind?: unknown;
  };
  return (
    (candidate.name === name || candidate.domain === domain) &&
    typeof candidate.kind === "string"
  );
}

function retryable(context: ViewerErrorContext, fallback: boolean) {
  if (context.retry === "always") return true;
  if (context.retry === "never") return false;
  return fallback;
}

function resourceErrorDefaultRetry(
  error: ResourceError,
  context: ViewerErrorContext,
) {
  if (error.kind === "aborted") return false;
  if (error.kind === "invalid_range") return false;
  if (error.kind === "too_large") return false;
  if (error.kind === "unsupported_capability") return false;
  return context.sourceKind === "url";
}

function formatErrorDefaultRetry(
  error: ViewerFormatError,
  context: ViewerErrorContext,
  format: ViewerFormat | undefined,
) {
  if (format === "text" && error.kind === "bounds") return false;
  if (error.kind === "disposed") return false;
  if (error.kind === "index_out_of_range") return false;
  if (format === "docx") return true;
  return context.sourceKind === "url";
}

function unknownErrorDefaultRetry(context: ViewerErrorContext) {
  if (context.format === "docx") return true;
  return context.sourceKind === "url";
}

function resourceErrorUserMessage(error: ResourceError) {
  if (error.kind === "http_error") {
    return error.status
      ? `Failed to load file: ${error.status}.`
      : "Couldn't load this file.";
  }
  if (error.kind === "fetch_failed") return "Couldn't load this file.";
  if (error.kind === "aborted") return "Loading was cancelled.";
  if (error.kind === "invalid_range") return "This source range is invalid.";
  if (error.kind === "too_large") {
    return error.tooLargeReason === "lines"
      ? "This file has too many lines to preview."
      : "This file is too large to preview.";
  }
  if (error.kind === "partial_content") {
    return "This source returned partial content and cannot be previewed here.";
  }
  if (error.kind === "unsupported_capability") {
    return "This source cannot be previewed here.";
  }
  return "Couldn't load this file.";
}

function formatErrorUserMessage(
  format: ViewerFormat | undefined,
  kind: string,
  error?: unknown,
) {
  if (format === "pdf") return "Couldn't load this PDF.";
  if (format === "image") {
    if (kind === "index_out_of_range")
      return "This image page is out of range.";
    if (kind === "decode_failed") return "Couldn't decode this image.";
    return "Couldn't load this image.";
  }
  if (format === "text") {
    if (kind === "render_failed") return "Couldn't render this text file.";
    if (kind === "bounds") {
      const boundsError = error as {
        reason?: unknown;
        boundName?: unknown;
      };
      if (boundsError.reason === "lines") {
        return "This text file has too many lines to preview.";
      }
      if (boundsError.reason === "bytes") {
        return "This text file is too large to preview.";
      }
      if (typeof boundsError.boundName === "string") {
        return "Text viewer bounds are invalid.";
      }
    }
    return "Couldn't load this text file.";
  }
  if (format === "csv") return "Couldn't parse this table.";
  if (format === "docx") return "Couldn't render this document.";
  if (format === "xlsx") return "Couldn't parse this spreadsheet.";
  if (format === "pptx") {
    if (kind === "render_failed") return "Couldn't render this slide.";
    return "Couldn't load this presentation.";
  }
  return "Couldn't load this file.";
}

function stateErrorUserMessage(kind: ViewerStateErrorKind) {
  if (kind === "invalid_bounds") return "Viewer bounds are invalid.";
  if (kind === "invalid_target") return "The requested target is invalid.";
  if (kind === "out_of_range") return "The requested item is out of range.";
  if (kind === "stale_resource") return "This viewer state is no longer valid.";
  return "Couldn't load this file.";
}

function fallbackUserMessage(format: ViewerFormat | undefined) {
  if (format === "pdf") return "Couldn't load this PDF.";
  if (format === "image") return "Couldn't load this image.";
  if (format === "text") return "Couldn't load this text file.";
  if (format === "csv") return "Couldn't parse this table.";
  if (format === "docx") return "Couldn't load this document.";
  if (format === "xlsx") return "Couldn't load this spreadsheet.";
  if (format === "pptx") return "Couldn't load this presentation.";
  return "Couldn't load this file.";
}
