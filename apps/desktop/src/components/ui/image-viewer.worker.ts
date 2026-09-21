import UTIF from "utif";

import type {
  TiffWorkerRequest,
  TiffWorkerResponse,
} from "@/lib/image-tiff-source";

interface Ifd {
  t256?: number[];
  t257?: number[];
  width?: number;
  height?: number;
  data?: unknown;
}

interface Utif {
  decode(buf: ArrayBuffer): Ifd[];
  decodeImage(buf: ArrayBuffer, ifd: Ifd): void;
  toRGBA8(ifd: Ifd): Uint8Array;
}

const utif = UTIF as Utif;
const ctx = self as unknown as Worker;

let buffer: ArrayBuffer | null = null;
let ifds: Ifd[] = [];
const canceledDecodeRequestIds = new Set<number>();
const decodeQueue: { requestId: number; frameIndex: number }[] = [];
let isDecoding = false;

ctx.onmessage = async (event: MessageEvent<TiffWorkerRequest>) => {
  const message = event.data;

  if (message.type === "init") {
    initialize(message.buffer);
    return;
  }

  if (message.type === "cancelDecode") {
    canceledDecodeRequestIds.add(message.requestId);
    return;
  }

  decodeQueue.push({
    requestId: message.requestId,
    frameIndex: message.frameIndex,
  });
  scheduleDecodeQueue();
};

function scheduleDecodeQueue() {
  if (isDecoding) return;
  setTimeout(processDecodeQueue, 0);
}

async function processDecodeQueue() {
  if (isDecoding) return;
  const next = decodeQueue.shift();
  if (!next) return;
  if (canceledDecodeRequestIds.delete(next.requestId)) {
    scheduleDecodeQueue();
    return;
  }
  isDecoding = true;
  try {
    await decodeFrame(next.requestId, next.frameIndex);
  } finally {
    isDecoding = false;
    if (decodeQueue.length > 0) scheduleDecodeQueue();
  }
}

function initialize(nextBuffer: ArrayBuffer) {
  try {
    buffer = nextBuffer;
    ifds = utif.decode(buffer);
    if (ifds.length === 0) throw new Error("TIFF has no frames");
    post({
      type: "initOk",
      frames: ifds.map((ifd, frameIndex) => {
        const width = frameWidth(ifd);
        const height = frameHeight(ifd);
        if (!width || !height) {
          throw new Error(`TIFF frame ${frameIndex + 1} has no dimensions`);
        }
        return { intrinsicSize: { width, height } };
      }),
    });
  } catch (error) {
    post({ type: "initError", message: errorMessage(error) });
  }
}

async function decodeFrame(requestId: number, frameIndex: number) {
  let didDecode = false;
  let ifd: Ifd | undefined;
  try {
    if (!buffer) throw new Error("worker not initialized");
    if (canceledDecodeRequestIds.delete(requestId)) return;
    if (frameIndex < 0 || frameIndex >= ifds.length) {
      throw new Error(`TIFF frame ${frameIndex + 1} is out of range`);
    }
    ifd = ifds[frameIndex];
    const width = frameWidth(ifd);
    const height = frameHeight(ifd);
    if (!width || !height) {
      throw new Error(`TIFF frame ${frameIndex + 1} has no dimensions`);
    }

    utif.decodeImage(buffer, ifd);
    didDecode = true;
    const rgba = utif.toRGBA8(ifd);
    const image = new ImageData(new Uint8ClampedArray(rgba), width, height);
    const bitmap = await createImageBitmap(image);
    if (canceledDecodeRequestIds.delete(requestId)) {
      bitmap.close();
      return;
    }
    post({ type: "decodeFrameOk", requestId, bitmap }, [bitmap]);
  } catch (error) {
    post({
      type: "decodeFrameError",
      requestId,
      message: `TIFF frame ${frameIndex + 1}: ${errorMessage(error)}`,
    });
  } finally {
    canceledDecodeRequestIds.delete(requestId);
    if (didDecode && ifd) delete ifd.data;
  }
}

function post(message: TiffWorkerResponse, transfer?: Transferable[]): void {
  ctx.postMessage(message, transfer ?? []);
}

function frameWidth(ifd: Ifd): number {
  return ifd.width ?? ifd.t256?.[0] ?? 0;
}

function frameHeight(ifd: Ifd): number {
  return ifd.height ?? ifd.t257?.[0] ?? 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "TIFF decode failed";
}
