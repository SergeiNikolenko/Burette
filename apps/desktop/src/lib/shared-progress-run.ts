// A long computation that belongs to the data it describes rather than to
// whoever happened to ask for it first. Callers attach to watch its progress and
// detach freely: leaving the panel, or changing an option that does not affect
// this stage, must not throw away work that is already half done. The run ends
// only when something explicitly ends it, and a caller rejoining part-way sees
// where it already is instead of an empty queue.
export type SharedRun<T, P> = {
  promise: Promise<T>;
  controller: AbortController;
  settled: boolean;
  lastProgress: P | null;
  listeners: Set<(progress: P) => void>;
};

export type SharedRunStore<T, P> = Map<string, SharedRun<T, P>>;

// Rejects when the caller walks away, leaving the shared run untouched.
function rejectOnAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  abortError: () => Error,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function trimSharedRuns<T, P>(runs: SharedRunStore<T, P>, maxRuns: number) {
  while (runs.size > maxRuns) {
    // Never evict a run that is still going: unfinished work is the one thing a
    // rejoining caller cannot get back cheaply.
    const oldestSettled = [...runs.entries()].find(([, run]) => run.settled);
    if (!oldestSettled) return;
    runs.delete(oldestSettled[0]);
  }
}

export function attachSharedRun<T, P>({
  runs,
  key,
  maxRuns,
  start,
  onProgress,
  signal,
  abortError,
}: {
  runs: SharedRunStore<T, P>;
  key: string;
  maxRuns: number;
  start: (report: (progress: P) => void, signal: AbortSignal) => Promise<T>;
  onProgress: (progress: P) => void;
  signal?: AbortSignal;
  abortError: () => Error;
}): Promise<T> {
  let run = runs.get(key);
  if (run) {
    runs.delete(key);
    runs.set(key, run);
    if (run.lastProgress !== null) onProgress(run.lastProgress);
  } else {
    const controller = new AbortController();
    const created: SharedRun<T, P> = {
      promise: Promise.resolve() as unknown as Promise<T>,
      controller,
      settled: false,
      lastProgress: null,
      listeners: new Set(),
    };
    created.promise = start((progress) => {
      created.lastProgress = progress;
      for (const listener of created.listeners) listener(progress);
    }, controller.signal);
    void created.promise.then(
      () => {
        created.settled = true;
        trimSharedRuns(runs, maxRuns);
      },
      () => {
        if (runs.get(key) === created) runs.delete(key);
      },
    );
    runs.set(key, created);
    run = created;
  }
  const attached = run;
  attached.listeners.add(onProgress);
  return rejectOnAbort(attached.promise, signal, abortError).finally(() => {
    attached.listeners.delete(onProgress);
  });
}

export function stopSharedRuns<T, P>(runs: SharedRunStore<T, P>, keyPrefix: string) {
  for (const [key, run] of [...runs]) {
    if (!key.startsWith(keyPrefix)) continue;
    runs.delete(key);
    if (!run.settled) run.controller.abort();
  }
}
