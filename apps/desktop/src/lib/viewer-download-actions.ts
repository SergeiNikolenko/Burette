export type ViewerDownloadOrigin = "original" | "derived";

export type ViewerDownloadPayload =
  | { kind: "href"; href: string }
  | { kind: "blob"; blob: Blob }
  | { kind: "text"; text: string; mimeType?: string }
  | { kind: "none" };

export interface ViewerDownloadAction {
  id: string;
  label: string;
  fileName: string;
  origin: ViewerDownloadOrigin;
  isDisabled?: boolean;
  getPayload: (options?: {
    signal?: AbortSignal;
  }) => ViewerDownloadPayload | Promise<ViewerDownloadPayload>;
}

export type ViewerDownloadErrorKind =
  | "disabled"
  | "aborted"
  | "payload_failed"
  | "unsupported";

export class ViewerDownloadError extends Error {
  readonly kind: ViewerDownloadErrorKind;
  readonly actionId: string;
  override readonly cause?: unknown;

  constructor({
    actionId,
    kind,
    message,
    cause,
  }: {
    actionId: string;
    kind: ViewerDownloadErrorKind;
    message: string;
    cause?: unknown;
  }) {
    super(message);
    this.name = "ViewerDownloadError";
    this.actionId = actionId;
    this.kind = kind;
    this.cause = cause;
  }
}

export function createHrefDownloadAction({
  id,
  label = "Download",
  href,
  fileName,
  origin = "original",
}: {
  id: string;
  label?: string;
  href: string;
  fileName: string;
  origin?: ViewerDownloadOrigin;
}): ViewerDownloadAction {
  return {
    id,
    label,
    fileName,
    origin,
    getPayload: () => ({ kind: "href", href }),
  };
}

export function createBlobDownloadAction({
  id,
  label = "Download",
  blob,
  fileName,
  origin = "original",
}: {
  id: string;
  label?: string;
  blob: Blob;
  fileName: string;
  origin?: ViewerDownloadOrigin;
}): ViewerDownloadAction {
  return {
    id,
    label,
    fileName,
    origin,
    getPayload: () => ({ kind: "blob", blob }),
  };
}

export function createTextDownloadAction({
  id,
  label = "Download",
  text,
  fileName,
  mimeType,
  origin = "original",
}: {
  id: string;
  label?: string;
  text: string;
  fileName: string;
  mimeType?: string;
  origin?: ViewerDownloadOrigin;
}): ViewerDownloadAction {
  return {
    id,
    label,
    fileName,
    origin,
    getPayload: () => ({ kind: "text", text, mimeType }),
  };
}

export function createDisabledDownloadAction({
  id,
  label = "Download",
  fileName,
  origin = "original",
}: {
  id: string;
  label?: string;
  fileName: string;
  origin?: ViewerDownloadOrigin;
}): ViewerDownloadAction {
  return {
    id,
    label,
    fileName,
    origin,
    isDisabled: true,
    getPayload: () => ({ kind: "none" }),
  };
}
