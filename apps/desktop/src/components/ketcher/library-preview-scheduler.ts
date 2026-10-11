// One chemistry preview per frame, shared by the library's visible cells.
export function createPreviewScheduler(request: (callback: FrameRequestCallback) => number, cancel: (id: number) => void) {
  const jobs = new Map<object, () => void>();
  let frame: number | null = null;
  function run() {
    frame = null;
    const next = jobs.entries().next().value;
    if (next) {
      jobs.delete(next[0]);
      try { next[1](); } finally {
        if (jobs.size && frame === null) frame = request(run);
      }
    }
  }
  return {
    schedule(key: object, job: () => void) {
      jobs.set(key, job);
      if (frame === null) frame = request(run);
    },
    cancel(key: object) {
      jobs.delete(key);
      if (!jobs.size && frame !== null) { cancel(frame); frame = null; }
    },
    get pending() { return jobs.size; },
  };
}
