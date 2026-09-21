import { registerThumbnailTestReset } from "./thumbnail-test-reset";

const MAX_CONCURRENT_DECODES = 3;
let activeDecodes = 0;
let decodeGeneration = 0;
const decodeQueue: Array<() => void> = [];

function acquireThumbnailDecodeSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const generation = decodeGeneration;
    const grant = () => {
      if (generation !== decodeGeneration) return;
      activeDecodes++;
      let hasReleased = false;
      resolve(() => {
        if (hasReleased) return;
        hasReleased = true;
        if (generation !== decodeGeneration) return;
        activeDecodes--;
        decodeQueue.shift()?.();
      });
    };
    if (activeDecodes < MAX_CONCURRENT_DECODES) grant();
    else decodeQueue.push(grant);
  });
}

export async function withThumbnailDecodeSlot<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const release = await acquireThumbnailDecodeSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

export function getThumbnailDecodeQueueSnapshot() {
  return {
    activeDecodes,
    queuedDecodes: decodeQueue.length,
    maxConcurrentDecodes: MAX_CONCURRENT_DECODES,
  };
}

function resetThumbnailDecodeQueueForTests() {
  decodeGeneration++;
  activeDecodes = 0;
  decodeQueue.splice(0);
}

registerThumbnailTestReset(resetThumbnailDecodeQueueForTests);
