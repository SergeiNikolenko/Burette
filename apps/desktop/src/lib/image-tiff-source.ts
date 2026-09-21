import {
  closeBitmap,
  createFrameSource,
  ImageDecodeError,
  ImageSourceDisposedError,
  type FrameDescriptor,
  type FrameSource,
} from "@/lib/image-frame-source";
import { ViewerFormatError } from "@/lib/viewer-errors";

export class TiffWorkerError extends ViewerFormatError {
  constructor(message: string, options?: ErrorOptions) {
    super({
      format: "image",
      kind: "worker_failed",
      message,
      cause: options?.cause,
    });
    this.name = "TiffWorkerError";
  }
}

export type TiffWorkerRequest =
  | { type: "init"; buffer: ArrayBuffer }
  | { type: "decodeFrame"; requestId: number; frameIndex: number }
  | { type: "cancelDecode"; requestId: number };

export type TiffWorkerResponse =
  | { type: "initOk"; frames: FrameDescriptor[] }
  | { type: "initError"; message: string }
  | { type: "decodeFrameOk"; requestId: number; bitmap: ImageBitmap }
  | { type: "decodeFrameError"; requestId: number; message: string };

export type TiffWorkerFactory = () => Worker;

interface PendingDecode {
  frameIndex: number;
  resolve(bitmap: ImageBitmap): void;
  reject(error: Error): void;
}

export class TiffWorkerClient {
  private readonly worker: Worker;
  private readonly pendingDecodes = new Map<number, PendingDecode>();
  private initResolve: ((frames: readonly FrameDescriptor[]) => void) | null =
    null;
  private initReject: ((error: Error) => void) | null = null;
  private initAbortCleanup: (() => void) | null = null;
  private nextRequestId = 0;
  private initialized = false;
  private disposed = false;

  constructor(createWorker: TiffWorkerFactory) {
    this.worker = createWorker();
    this.worker.onmessage = (event: MessageEvent<TiffWorkerResponse>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event) => {
      this.fail(new TiffWorkerError(event.message || "TIFF worker failed"));
    };
    this.worker.onmessageerror = () => {
      this.fail(new TiffWorkerError("TIFF worker sent an unreadable message"));
    };
  }

  init(
    buffer: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<readonly FrameDescriptor[]> {
    if (this.disposed) {
      return Promise.reject(new TiffWorkerError("TIFF worker disposed"));
    }
    if (this.initResolve) {
      return Promise.reject(
        new TiffWorkerError("TIFF worker already initializing"),
      );
    }
    if (this.initialized) {
      return Promise.reject(
        new TiffWorkerError("TIFF worker already initialized"),
      );
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.initAbortCleanup?.();
        this.initAbortCleanup = null;
      };
      this.initResolve = (frames) => {
        cleanup();
        resolve(frames);
      };
      this.initReject = (error) => {
        cleanup();
        reject(error);
      };
      if (signal) {
        const abort = () => {
          this.dispose(abortSignalReason(signal));
        };
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener("abort", abort, { once: true });
        this.initAbortCleanup = () => {
          signal.removeEventListener("abort", abort);
        };
      }
      try {
        this.worker.postMessage({ type: "init", buffer }, [buffer]);
      } catch (error) {
        const workerError = new TiffWorkerError(
          "Failed to initialize TIFF worker",
          {
            cause: error,
          },
        );
        this.disposed = true;
        this.rejectInit(workerError);
        this.rejectPending(workerError);
        this.worker.terminate();
      }
    });
  }

  decode(frameIndex: number): Promise<ImageBitmap> {
    if (this.disposed) {
      return Promise.reject(new TiffWorkerError("TIFF worker disposed"));
    }
    return new Promise((resolve, reject) => {
      const requestId = this.nextRequestId++;
      this.pendingDecodes.set(requestId, { frameIndex, resolve, reject });
      try {
        this.worker.postMessage({ type: "decodeFrame", requestId, frameIndex });
      } catch (error) {
        const workerError = new TiffWorkerError(
          "Failed to request TIFF frame decode",
          {
            cause: error,
          },
        );
        this.pendingDecodes.delete(requestId);
        this.disposed = true;
        this.rejectPending(workerError);
        this.worker.terminate();
        reject(workerError);
      }
    });
  }

  cancelDecode(
    frameIndex: number,
    reason: Error = new TiffWorkerError("TIFF decode canceled"),
  ) {
    for (const [requestId, pending] of this.pendingDecodes) {
      if (pending.frameIndex !== frameIndex) continue;
      this.pendingDecodes.delete(requestId);
      pending.reject(reason);
      try {
        this.worker.postMessage({ type: "cancelDecode", requestId });
      } catch {
        // The local promise is already rejected; worker transport may be gone.
      }
    }
  }

  dispose(reason: Error = new TiffWorkerError("TIFF worker disposed")) {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectInit(reason);
    this.rejectPending(reason);
    this.worker.terminate();
  }

  private handleMessage(message: TiffWorkerResponse) {
    if (message.type === "initOk") {
      if (!isFrameDescriptorList(message.frames)) {
        this.fail(
          new TiffWorkerError("TIFF worker sent an invalid init response"),
        );
        return;
      }
      try {
        validateWorkerFrameDescriptors(message.frames);
      } catch (error) {
        this.fail(
          error instanceof Error
            ? error
            : new ImageDecodeError("Image decode failed"),
        );
        return;
      }
      this.initialized = true;
      this.initResolve?.(message.frames);
      this.initResolve = null;
      this.initReject = null;
      return;
    }
    if (message.type === "initError") {
      if (typeof message.message !== "string") {
        this.fail(
          new TiffWorkerError("TIFF worker sent an invalid init response"),
        );
        return;
      }
      const error = new TiffWorkerError(message.message);
      this.disposed = true;
      this.rejectPending(error);
      this.rejectInit(error);
      this.worker.terminate();
      return;
    }
    if (message.type === "decodeFrameOk") {
      if (
        !isWorkerRequestId(message.requestId) ||
        !isImageBitmap(message.bitmap)
      ) {
        closeBitmapLike(message.bitmap);
        this.fail(
          new TiffWorkerError("TIFF worker sent an invalid decode response"),
        );
        return;
      }
      const pending = this.pendingDecodes.get(message.requestId);
      this.pendingDecodes.delete(message.requestId);
      if (pending) pending.resolve(message.bitmap);
      else closeBitmap(message.bitmap);
      return;
    }
    if (message.type === "decodeFrameError") {
      if (
        !isWorkerRequestId(message.requestId) ||
        typeof message.message !== "string"
      ) {
        this.fail(
          new TiffWorkerError("TIFF worker sent an invalid decode response"),
        );
        return;
      }
      const pending = this.pendingDecodes.get(message.requestId);
      this.pendingDecodes.delete(message.requestId);
      pending?.reject(new ImageDecodeError(message.message));
      return;
    }
    this.fail(new TiffWorkerError("TIFF worker sent an unknown message"));
  }

  private fail(error: Error) {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectPending(error);
    this.rejectInit(error);
    this.worker.terminate();
  }

  private rejectInit(error: Error) {
    this.initReject?.(error);
    this.initResolve = null;
    this.initReject = null;
  }

  private rejectPending(error: Error) {
    for (const pending of this.pendingDecodes.values()) pending.reject(error);
    this.pendingDecodes.clear();
  }
}

export async function createTiffFrameSource(
  buffer: ArrayBuffer,
  createWorker: TiffWorkerFactory,
  maxDecodedFrames: number,
  signal?: AbortSignal,
  maxDecodedPixels?: number,
): Promise<FrameSource> {
  const client = new TiffWorkerClient(createWorker);
  const frames = await client.init(buffer, signal);
  try {
    return createFrameSource({
      kind: "tiff",
      frames,
      maxDecodedFrames,
      maxDecodedPixels,
      decode: (frameIndex) => client.decode(frameIndex),
      cancelDecode: (frameIndex, reason) =>
        client.cancelDecode(frameIndex, reason),
      onDispose: (reason) => client.dispose(reason),
    });
  } catch (error) {
    client.dispose(error instanceof Error ? error : undefined);
    throw error;
  }
}

function abortSignalReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new ImageSourceDisposedError();
}

function isWorkerRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isImageBitmap(value: unknown): value is ImageBitmap {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<ImageBitmap>).close === "function" &&
    Number.isFinite((value as Partial<ImageBitmap>).width) &&
    Number.isFinite((value as Partial<ImageBitmap>).height) &&
    (value as Partial<ImageBitmap>).width! > 0 &&
    (value as Partial<ImageBitmap>).height! > 0
  );
}

function closeBitmapLike(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<ImageBitmap>).close === "function"
  ) {
    closeBitmap(value as ImageBitmap);
  }
}

function isFrameDescriptorList(value: unknown): value is FrameDescriptor[] {
  return (
    Array.isArray(value) &&
    value.every((frame) => {
      if (typeof frame !== "object" || frame === null) return false;
      const intrinsicSize = (frame as Partial<FrameDescriptor>).intrinsicSize;
      return (
        typeof intrinsicSize === "object" &&
        intrinsicSize !== null &&
        typeof intrinsicSize.width === "number" &&
        typeof intrinsicSize.height === "number"
      );
    })
  );
}

function validateWorkerFrameDescriptors(frames: readonly FrameDescriptor[]) {
  if (frames.length === 0) {
    throw new ImageDecodeError("Image does not contain any frames");
  }
  for (const [frameIndex, frame] of frames.entries()) {
    const { width, height } = frame.intrinsicSize;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new ImageDecodeError(
        `Image frame ${frameIndex + 1} has invalid dimensions`,
      );
    }
  }
}
