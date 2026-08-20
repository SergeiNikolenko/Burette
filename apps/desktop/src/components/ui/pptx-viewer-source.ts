import type {
  ViewerContentBytes,
  ViewerContentIdentity,
} from "@/lib/viewer-resource";

import {
  DisposableLruCache,
  PptxBitmapEntry,
  type Disposable,
} from "./pptx-viewer-cache";
import {
  getPptxBitmapCacheKey,
  type PptxBitmapCacheInput,
  type PptxSize,
  type PptxSlideRenderPriority,
  type PptxSourceLoadTiming,
} from "./pptx-viewer-core";
import {
  createPptxRenderer,
  PptxRendererError,
  type PptxRenderer,
} from "./pptx-viewer-renderer";

const PPTX_SOURCE_CACHE_MAX = 4;
const PPTX_SOURCE_TIMING_CACHE_MAX = 32;
const PPTX_BITMAP_CACHE_MAX = 8;
const PPTX_BITMAP_CACHE_MAX_PIXELS = 24_000_000;

export type PptxSourceRelease = () => void;

export interface PptxSourceRenderInput extends PptxBitmapCacheInput {
  canvas: HTMLCanvasElement;
  isLive?: () => boolean;
  priority?: PptxSlideRenderPriority;
}

export interface PptxSourceDrawCachedBitmapInput extends PptxBitmapCacheInput {
  canvas: HTMLCanvasElement;
}

export type PptxRenderResult =
  | { status: "rendered" }
  | { status: "cancelled" }
  | { status: "failed"; error: PptxRendererError };

export interface PptxSource extends Disposable {
  slideCount: number;
  baseSize: PptxSize;
  drawCachedBitmap(
    input: PptxSourceDrawCachedBitmapInput,
  ): PptxRenderResult | null;
  renderSlide(input: PptxSourceRenderInput): Promise<PptxRenderResult>;
  hasBitmap(input: PptxBitmapCacheInput): boolean;
  retain(): PptxSourceRelease;
}

class RendererSource implements PptxSource {
  readonly slideCount: number;
  readonly baseSize: PptxSize;

  private readonly bitmaps = new DisposableLruCache<string, PptxBitmapEntry>(
    PPTX_BITMAP_CACHE_MAX,
    {
      maxCost: PPTX_BITMAP_CACHE_MAX_PIXELS,
      getCost: (entry) => entry.pixelCount,
    },
  );
  private queue: PptxQueuedRender[] = [];
  private isRendering = false;
  private nextSequence = 1;
  private bitmapSnapshots = new Map<string, Promise<void>>();
  private retainCount = 0;
  private disposeRequested = false;
  private disposed = false;

  constructor(private readonly renderer: PptxRenderer) {
    this.slideCount = renderer.slideCount;
    this.baseSize = renderer.baseSize;
  }

  hasBitmap(input: PptxBitmapCacheInput) {
    if (this.disposed) return false;
    return this.bitmaps.get(getPptxBitmapCacheKey(input)) !== undefined;
  }

  drawCachedBitmap(
    input: PptxSourceDrawCachedBitmapInput,
  ): PptxRenderResult | null {
    if (this.disposed) return null;
    const cached = this.bitmaps.get(getPptxBitmapCacheKey(input));
    if (!cached) return null;
    return drawPptxBitmap(input.canvas, cached.bitmap);
  }

  renderSlide(input: PptxSourceRenderInput): Promise<PptxRenderResult> {
    if (this.disposed) {
      return Promise.resolve({
        status: "failed",
        error: new PptxRendererError(
          "disposed",
          "Presentation source was disposed.",
        ),
      });
    }
    if (!isValidSlideIndex(input.slideIndex, this.slideCount)) {
      return Promise.resolve({
        status: "failed",
        error: new PptxRendererError(
          "index_out_of_range",
          `Slide ${input.slideIndex + 1} is outside the presentation.`,
        ),
      });
    }
    if (!isValidRenderScale(input.renderScale)) {
      return Promise.resolve({
        status: "failed",
        error: new PptxRendererError(
          "bounds",
          "Render scale must be a positive finite number.",
        ),
      });
    }

    const bitmapKey = getPptxBitmapCacheKey(input);
    if (this.hasBitmap(input)) {
      if (!isRenderLive(input)) return Promise.resolve({ status: "cancelled" });
      const cached = this.drawCachedBitmap(input);
      if (cached) return Promise.resolve(cached);
    }

    const snapshot = this.bitmapSnapshots.get(bitmapKey);
    if (snapshot) return this.renderAfterSnapshot(input, snapshot);

    return new Promise<PptxRenderResult>((resolve) => {
      this.queue.push({
        bitmapKey,
        input,
        resolve,
        sequence: this.nextSequence,
      });
      this.nextSequence += 1;
      this.pumpQueue();
    });
  }

  retain(): PptxSourceRelease {
    if (this.disposed) return () => {};
    this.retainCount += 1;
    let hasReleased = false;
    return () => {
      if (hasReleased) return;
      hasReleased = true;
      this.retainCount -= 1;
      if (this.retainCount === 0 && this.disposeRequested) this.close();
    };
  }

  dispose() {
    this.disposeRequested = true;
    if (this.retainCount === 0) this.close();
  }

  private close() {
    if (this.disposed) return;
    this.disposed = true;
    for (const task of this.queue.splice(0))
      task.resolve({ status: "cancelled" });
    this.bitmapSnapshots.clear();
    this.bitmaps.clear();
    this.renderer.dispose();
  }

  private pumpQueue() {
    if (this.isRendering) return;
    this.isRendering = true;
    void this.drainQueue();
  }

  private async drainQueue() {
    try {
      while (!this.disposed && this.queue.length > 0) {
        const task = this.takeNextTask();
        if (!task) break;
        await this.runTask(task);
      }
    } finally {
      this.isRendering = false;
      if (!this.disposed && this.queue.length > 0) this.pumpQueue();
    }
  }

  private takeNextTask() {
    this.pruneStaleQueuedTasks();

    let bestIndex = -1;
    let bestRank: PptxRenderRank | null = null;
    for (let index = 0; index < this.queue.length; index += 1) {
      const task = this.queue[index];
      if (!task) continue;
      const rank = getRenderRank(task);
      if (!bestRank || compareRenderRanks(rank, bestRank) < 0) {
        bestRank = rank;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) return null;
    const [task] = this.queue.splice(bestIndex, 1);
    return task ?? null;
  }

  private pruneStaleQueuedTasks() {
    const liveQueue: PptxQueuedRender[] = [];
    for (const task of this.queue) {
      if (isRenderLive(task.input)) {
        liveQueue.push(task);
      } else {
        task.resolve({ status: "cancelled" });
      }
    }
    this.queue = liveQueue;
  }

  private async runTask(task: PptxQueuedRender) {
    if (this.disposed) {
      task.resolve({ status: "cancelled" });
      return;
    }
    if (!isRenderLive(task.input)) {
      task.resolve({ status: "cancelled" });
      return;
    }

    const cached = this.drawCachedBitmap(task.input);
    if (cached) {
      task.resolve(cached);
      return;
    }

    const pendingSnapshot = this.bitmapSnapshots.get(task.bitmapKey);
    if (pendingSnapshot) {
      task.resolve(this.renderAfterSnapshot(task.input, pendingSnapshot));
      return;
    }

    try {
      await this.renderer.renderSlide(task.input);
    } catch (error) {
      if (this.disposed || !isRenderLive(task.input)) {
        task.resolve({ status: "cancelled" });
        return;
      }
      task.resolve({
        status: "failed",
        error: normalizeRendererError(error),
      });
      return;
    }

    if (this.disposed || !isRenderLive(task.input)) {
      task.resolve({ status: "cancelled" });
      return;
    }

    const snapshot = this.scheduleBitmapSnapshot(task);
    this.resolveQueuedBitmapDuplicates(task.bitmapKey, snapshot);
    task.resolve({ status: "rendered" });
  }

  private renderAfterSnapshot(
    input: PptxSourceRenderInput,
    snapshot: Promise<void>,
  ): Promise<PptxRenderResult> {
    return snapshot.then(
      () => {
        if (this.disposed) return { status: "cancelled" };
        if (!isRenderLive(input)) return { status: "cancelled" };
        const cached = this.drawCachedBitmap(input);
        if (cached) return cached;
        return this.renderSlide(input);
      },
      () => {
        if (this.disposed) return { status: "cancelled" };
        if (!isRenderLive(input)) return { status: "cancelled" };
        return this.renderSlide(input);
      },
    );
  }

  private scheduleBitmapSnapshot(task: PptxQueuedRender) {
    const snapshot = this.captureBitmap(task);
    this.bitmapSnapshots.set(task.bitmapKey, snapshot);
    snapshot.finally(() => {
      if (this.bitmapSnapshots.get(task.bitmapKey) === snapshot) {
        this.bitmapSnapshots.delete(task.bitmapKey);
      }
    });
    return snapshot;
  }

  private resolveQueuedBitmapDuplicates(
    bitmapKey: string,
    snapshot: Promise<void>,
  ) {
    const remainingQueue: PptxQueuedRender[] = [];
    for (const queued of this.queue) {
      if (queued.bitmapKey !== bitmapKey) {
        remainingQueue.push(queued);
      } else if (isRenderLive(queued.input)) {
        queued.resolve(this.renderAfterSnapshot(queued.input, snapshot));
      } else {
        queued.resolve({ status: "cancelled" });
      }
    }
    this.queue = remainingQueue;
  }

  private async captureBitmap(task: PptxQueuedRender) {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(task.input.canvas);
      if (this.disposed || !isRenderLive(task.input)) {
        bitmap.close();
        return;
      }
      this.bitmaps.set(task.bitmapKey, new PptxBitmapEntry(bitmap));
      bitmap = null;
    } catch {
      if (bitmap) bitmap.close();
      /* Snapshot unsupported: the slide still rendered, just without cache. */
    }
  }
}

type PptxQueuedRender = {
  bitmapKey: string;
  input: PptxSourceRenderInput;
  resolve: (result: PptxRenderResult | PromiseLike<PptxRenderResult>) => void;
  sequence: number;
};

type PptxRenderRank = {
  visibility: number;
  distance: number;
  sequence: number;
};

function getRenderRank(task: PptxQueuedRender): PptxRenderRank {
  const priority = task.input.priority;
  return {
    visibility: priority?.isCurrentSlide
      ? 0
      : priority?.isInViewport
        ? 1
        : priority?.isScrollLead
          ? 2
          : 3,
    distance:
      priority && Number.isFinite(priority.distanceFromReadingMarker)
        ? Math.max(0, priority.distanceFromReadingMarker)
        : Number.MAX_SAFE_INTEGER,
    sequence: task.sequence,
  };
}

function compareRenderRanks(a: PptxRenderRank, b: PptxRenderRank) {
  if (a.visibility !== b.visibility) return a.visibility - b.visibility;
  if (a.distance !== b.distance) return a.distance - b.distance;
  return a.sequence - b.sequence;
}

class SourceCacheEntry implements Disposable {
  source?: PptxSource;
  loadTiming?: PptxSourceLoadTiming;
  disposed = false;
  private settled = false;
  private readonly loadTimingSubscribers = new Set<
    (timing: PptxSourceLoadTiming) => void
  >();

  constructor(readonly promise: Promise<PptxSource>) {
    promise.then(
      (source) => {
        this.settled = true;
        this.source = source;
        if (this.disposed) source.dispose();
      },
      () => {
        this.settled = true;
        /* rejected entries are removed by getPptxSource */
      },
    );
  }

  /**
   * A still-loading entry must not be evicted: dispose() cannot act on a source
   * that has not resolved yet, so an evicted-pending entry would leak its
   * renderer once the load completes (and a Suspense retry would create a
   * duplicate). Pin it until the load settles.
   */
  isEvictable() {
    return this.settled || this.disposed;
  }

  dispose() {
    this.loadTimingSubscribers.clear();
    this.disposed = true;
    this.source?.dispose();
  }

  disposeWhenResolved() {
    this.disposed = true;
    this.loadTimingSubscribers.clear();
    this.source?.dispose();
  }

  setLoadTiming(timing: PptxSourceLoadTiming) {
    this.loadTiming = timing;
    for (const subscriber of this.loadTimingSubscribers) {
      notifyLoadTimingSubscriber(subscriber, timing);
    }
  }

  subscribeLoadTiming(callback: (timing: PptxSourceLoadTiming) => void) {
    this.loadTimingSubscribers.add(callback);
    if (this.loadTiming) {
      const loadTiming = this.loadTiming;
      setTimeout(() => {
        if (this.loadTimingSubscribers.has(callback)) {
          notifyLoadTimingSubscriber(callback, loadTiming);
        }
      }, 0);
    }
    return () => {
      this.loadTimingSubscribers.delete(callback);
    };
  }
}

function notifyLoadTimingSubscriber(
  subscriber: (timing: PptxSourceLoadTiming) => void,
  timing: PptxSourceLoadTiming,
) {
  try {
    subscriber(timing);
  } catch {
    /* Instrumentation callbacks must not affect viewer loading. */
  }
}

const sourceCache = new DisposableLruCache<string, SourceCacheEntry>(
  PPTX_SOURCE_CACHE_MAX,
);
const sourceLoadTimingCache = new Map<string, PptxSourceLoadTiming>();

export function getPptxSource(
  content: ViewerContentBytes,
): Promise<PptxSource> {
  const loadKey = content.key;
  const cached = sourceCache.get(loadKey);
  if (cached) return cached.promise;

  sourceLoadTimingCache.delete(loadKey);

  const pendingEntry: { current?: SourceCacheEntry } = {};
  let pendingLoadTiming: PptxSourceLoadTiming | null = null;
  const handleLoadTiming = (timing: PptxSourceLoadTiming) => {
    rememberSourceLoadTiming(loadKey, timing);
    if (pendingEntry.current) {
      pendingEntry.current.setLoadTiming(timing);
    } else {
      pendingLoadTiming = timing;
    }
  };
  const promise = createPptxRenderer(content, handleLoadTiming).then(
    (renderer) => new RendererSource(renderer),
    (error) => {
      scheduleFailedSourceEviction(loadKey, pendingEntry.current);
      throw error;
    },
  );
  const entry = new SourceCacheEntry(promise);
  pendingEntry.current = entry;
  if (pendingLoadTiming) entry.setLoadTiming(pendingLoadTiming);
  sourceCache.set(loadKey, entry);
  return entry.promise;
}

export function subscribePptxSourceLoadTiming(
  content: ViewerContentIdentity,
  callback: (timing: PptxSourceLoadTiming) => void,
) {
  const loadKey = content.key;
  const entry = sourceCache.get(loadKey);
  if (!entry) return subscribeCachedSourceLoadTiming(loadKey, callback);
  return entry.subscribeLoadTiming(callback);
}

export function evictPptxSource(content: ViewerContentIdentity) {
  sourceLoadTimingCache.delete(content.key);
  sourceCache.delete(content.key);
}

function subscribeCachedSourceLoadTiming(
  loadKey: string,
  callback: (timing: PptxSourceLoadTiming) => void,
) {
  const loadTiming = sourceLoadTimingCache.get(loadKey);
  if (!loadTiming) return () => {};
  let isSubscribed = true;
  setTimeout(() => {
    if (isSubscribed) notifyLoadTimingSubscriber(callback, loadTiming);
  }, 0);
  return () => {
    isSubscribed = false;
  };
}

function rememberSourceLoadTiming(
  loadKey: string,
  timing: PptxSourceLoadTiming,
) {
  sourceLoadTimingCache.delete(loadKey);
  sourceLoadTimingCache.set(loadKey, timing);
  while (sourceLoadTimingCache.size > PPTX_SOURCE_TIMING_CACHE_MAX) {
    const oldestLoadKey = sourceLoadTimingCache.keys().next().value;
    if (!oldestLoadKey) return;
    sourceLoadTimingCache.delete(oldestLoadKey);
  }
}

function scheduleFailedSourceEviction(
  loadKey: string,
  entry: SourceCacheEntry | undefined,
) {
  if (!entry) return;
  setTimeout(() => {
    if (sourceCache.get(loadKey) === entry) sourceCache.delete(loadKey);
  }, 0);
}

export function disposePptxSourceCache() {
  for (const entry of sourceCache.snapshotValues()) {
    entry.disposeWhenResolved();
  }
  sourceCache.clear();
  sourceLoadTimingCache.clear();
}

function isRenderLive({ isLive }: Pick<PptxSourceRenderInput, "isLive">) {
  try {
    return !isLive || isLive();
  } catch {
    return false;
  }
}

function isValidSlideIndex(slideIndex: number, slideCount: number) {
  return (
    Number.isInteger(slideIndex) && slideIndex >= 0 && slideIndex < slideCount
  );
}

function isValidRenderScale(renderScale: number) {
  return Number.isFinite(renderScale) && renderScale > 0;
}

function drawPptxBitmap(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
): PptxRenderResult {
  try {
    drawBitmap(canvas, bitmap);
    return { status: "rendered" };
  } catch (error) {
    return {
      status: "failed",
      error: new PptxRendererError(
        "render_failed",
        "Failed to draw cached slide bitmap.",
        error,
      ),
    };
  }
}

function drawBitmap(canvas: HTMLCanvasElement, bitmap: ImageBitmap) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  context.drawImage(bitmap, 0, 0);
}

function normalizeRendererError(error: unknown) {
  if (error instanceof PptxRendererError) return error;
  return new PptxRendererError(
    "render_failed",
    "Failed to render slide.",
    error,
  );
}
