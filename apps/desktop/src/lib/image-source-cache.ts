import {
  createNativeImageFrameSourceFromBlob,
  ImageDecodeError,
  ImageLoadError,
  ImageSourceDisposedError,
  isDeclaredNativeImage,
  isDeclaredTiff,
  isTiffBytes,
  type FrameSource,
} from "@/lib/image-frame-source";
import {
  createTiffFrameSource,
  type TiffWorkerFactory,
} from "@/lib/image-tiff-source";
import type {
  ViewerContentBlob,
  ViewerContentBytes,
  ViewerContentDirectUrl,
  ViewerContentIdentity,
  ViewerContentMime,
  ViewerContentPayload,
} from "@/lib/viewer-resource";

const DEFAULT_MAX_DECODED_FRAMES = 16;
const DEFAULT_MAX_DECODED_PIXELS = 64_000_000;
const DEFAULT_UNCLAIMED_SOURCE_TIMEOUT_MS = 30_000;
const DEFAULT_RELEASED_SOURCE_TIMEOUT_MS = 10_000;
const TIFF_SIGNATURE_BYTE_COUNT = 4;

export interface FrameSourceLease {
  source: FrameSource;
  release(): void;
}

export type ImageSourceContent = ViewerContentIdentity &
  ViewerContentDirectUrl &
  ViewerContentMime &
  ViewerContentPayload &
  ViewerContentBlob &
  ViewerContentBytes;

type FrameSourceEntryState = "pending" | "resolved" | "evictable" | "disposed";

interface FrameSourceEntry {
  content: ImageSourceContent;
  abortController: AbortController;
  promise: Promise<FrameSource>;
  source?: FrameSource;
  leaseCount: number;
  state: FrameSourceEntryState;
  disposeReason?: Error;
  disposeTimer?: ReturnType<typeof setTimeout>;
}

interface FrameSourceManagerOptions {
  maxDecodedFrames?: number;
  maxDecodedPixels?: number;
  releasedSourceTimeoutMs?: number;
  unclaimedSourceTimeoutMs?: number;
}

export class FrameSourceManager {
  private readonly entries = new Map<string, FrameSourceEntry>();
  private readonly maxDecodedFrames: number;
  private readonly maxDecodedPixels: number;
  private readonly releasedSourceTimeoutMs: number;
  private readonly unclaimedSourceTimeoutMs: number;

  constructor(options: FrameSourceManagerOptions = {}) {
    this.maxDecodedFrames =
      options.maxDecodedFrames ?? DEFAULT_MAX_DECODED_FRAMES;
    this.maxDecodedPixels =
      options.maxDecodedPixels ?? DEFAULT_MAX_DECODED_PIXELS;
    this.releasedSourceTimeoutMs =
      options.releasedSourceTimeoutMs ?? DEFAULT_RELEASED_SOURCE_TIMEOUT_MS;
    this.unclaimedSourceTimeoutMs =
      options.unclaimedSourceTimeoutMs ?? DEFAULT_UNCLAIMED_SOURCE_TIMEOUT_MS;
  }

  load(
    content: ImageSourceContent,
    createTiffWorker: TiffWorkerFactory,
  ): Promise<FrameSource> {
    const loadKey = content.key;
    let entry = this.entries.get(loadKey);
    if (!entry) {
      const abortController = new AbortController();
      const newEntry: FrameSourceEntry = {
        content,
        abortController,
        promise: Promise.resolve().then(() =>
          this.createSource(content, createTiffWorker, abortController.signal),
        ),
        leaseCount: 0,
        state: "pending",
      };
      newEntry.promise = newEntry.promise
        .then((source) => {
          newEntry.source = source;
          if (newEntry.state === "disposed") {
            source.dispose(
              newEntry.disposeReason ?? new ImageSourceDisposedError(),
            );
            this.entries.delete(loadKey);
            newEntry.state = "disposed";
            throw new ImageLoadError("Image source was disposed before use");
          }
          if (newEntry.leaseCount === 0) {
            newEntry.state = "evictable";
            this.scheduleDispose(
              newEntry,
              this.unclaimedSourceTimeoutMs,
              new ImageSourceDisposedError(),
            );
          } else {
            newEntry.state = "resolved";
          }
          return source;
        })
        .catch((error) => {
          if (this.entries.get(loadKey) === newEntry) {
            this.entries.delete(loadKey);
          }
          if (
            newEntry.state === "disposed" &&
            error instanceof ImageDecodeError
          ) {
            throw newEntry.disposeReason ?? new ImageSourceDisposedError();
          }
          throw error;
        });
      entry = newEntry;
      this.entries.set(loadKey, entry);
    }
    return entry.promise;
  }

  retain(
    content: ViewerContentIdentity,
    source: FrameSource,
  ): FrameSourceLease | null {
    const entry = this.entries.get(content.key);
    if (!entry || entry.source !== source || entry.state === "disposed") {
      return null;
    }
    this.cancelDispose(entry);
    entry.state = "resolved";
    entry.leaseCount += 1;
    let hasReleased = false;
    return {
      source,
      release: () => {
        if (hasReleased) return;
        hasReleased = true;
        const current = this.entries.get(content.key);
        if (!current || current.source !== source) return;
        current.leaseCount = Math.max(0, current.leaseCount - 1);
        if (current.leaseCount === 0) {
          current.state = "evictable";
          this.scheduleDispose(
            current,
            this.releasedSourceTimeoutMs,
            new ImageSourceDisposedError(),
          );
        }
      },
    };
  }

  clear() {
    for (const entry of [...this.entries.values()]) {
      this.disposeEntry(entry, new ImageSourceDisposedError());
    }
  }

  private async createSource(
    content: ImageSourceContent,
    createTiffWorker: TiffWorkerFactory,
    signal: AbortSignal,
  ): Promise<FrameSource> {
    const sourceName = imageSourceName(content);
    const declaredContentType = imageContentType(content);

    if (isDeclaredTiff(sourceName, declaredContentType)) {
      return createTiffFrameSource(
        await readContentBytes(content, { signal }),
        createTiffWorker,
        this.maxDecodedFrames,
        signal,
        this.maxDecodedPixels,
      );
    }

    if (isDeclaredNativeImage(sourceName, declaredContentType)) {
      return createNativeImageFrameSourceFromBlob(
        await content.readBlob({ signal }),
        this.maxDecodedFrames,
        this.maxDecodedPixels,
      );
    }

    const blob = await content.readBlob({ signal });
    return this.createSourceFromUnknownBlob(
      sourceName,
      blob,
      createTiffWorker,
      signal,
    );
  }

  private disposeEntry(entry: FrameSourceEntry, reason: Error) {
    if (entry.state === "disposed") return;
    entry.state = "disposed";
    entry.disposeReason = reason;
    this.cancelDispose(entry);
    entry.abortController.abort(reason);
    entry.source?.dispose(reason);
    if (this.entries.get(entry.content.key) === entry) {
      this.entries.delete(entry.content.key);
    }
  }

  private scheduleDispose(
    entry: FrameSourceEntry,
    delayMs: number,
    reason: Error,
  ) {
    this.cancelDispose(entry);
    entry.disposeReason = reason;
    entry.disposeTimer = setTimeout(() => {
      const current = this.entries.get(entry.content.key);
      if (!current || current !== entry || current.leaseCount > 0) return;
      this.disposeEntry(current, reason);
    }, delayMs);
  }

  private cancelDispose(entry: FrameSourceEntry) {
    if (!entry.disposeTimer) return;
    clearTimeout(entry.disposeTimer);
    entry.disposeTimer = undefined;
  }

  private async createSourceFromUnknownBlob(
    sourceName: string,
    blob: Blob,
    createTiffWorker: TiffWorkerFactory,
    signal: AbortSignal,
  ): Promise<FrameSource> {
    const contentType = blob.type || null;
    const prefix = await blob.slice(0, TIFF_SIGNATURE_BYTE_COUNT).arrayBuffer();
    if (isTiffBytes(sourceName, contentType, prefix)) {
      return createTiffFrameSource(
        await blob.arrayBuffer(),
        createTiffWorker,
        this.maxDecodedFrames,
        signal,
        this.maxDecodedPixels,
      );
    }

    return createNativeImageFrameSourceFromBlob(
      blob,
      this.maxDecodedFrames,
      this.maxDecodedPixels,
    );
  }
}

export const imageFrameSourceManager = new FrameSourceManager();

function imageSourceName(content: ViewerContentDirectUrl): string {
  return content.directUrl ?? "";
}

function imageContentType(
  content: ViewerContentPayload & ViewerContentMime,
): string | null {
  if (content.mimeType) return content.mimeType;
  if (content.payload.kind === "blob") return content.payload.blob.type || null;
  return null;
}

function readContentBytes(
  content: ViewerContentBytes,
  options: { signal: AbortSignal },
): Promise<ArrayBuffer> {
  return content.readBytes(options);
}
