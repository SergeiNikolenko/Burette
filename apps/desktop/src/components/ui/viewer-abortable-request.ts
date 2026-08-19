export interface SharedAbortableRequest<T> {
  controller: AbortController;
  promise: Promise<T>;
  subscriberPromises: WeakMap<AbortSignal, Promise<T>>;
  subscribers: Set<AbortSignal>;
  settled: boolean;
}

export function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function promiseForSignal<T>(
  map: WeakMap<AbortSignal, Promise<T>>,
  signal: AbortSignal,
  create: () => Promise<T>,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());

  const existingPromise = map.get(signal);
  if (existingPromise) return existingPromise;

  const promise = create().catch((error: unknown) => {
    map.delete(signal);
    throw error;
  });
  map.set(signal, promise);
  return promise;
}

export function subscribeToAbortableRequest<T>(
  entry: SharedAbortableRequest<T>,
  signal: AbortSignal,
  onNoSubscribers: () => void,
): Promise<T> {
  return promiseForSignal(entry.subscriberPromises, signal, () => {
    entry.subscribers.add(signal);

    return new Promise<T>((resolve, reject) => {
      let done = false;

      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
        entry.subscribers.delete(signal);
      };

      const onAbort = () => {
        if (done) return;
        done = true;
        cleanup();
        if (!entry.settled && entry.subscribers.size === 0) {
          entry.controller.abort();
          onNoSubscribers();
        }
        reject(abortError());
      };

      signal.addEventListener("abort", onAbort, { once: true });

      entry.promise.then(
        (value) => {
          if (done) return;
          done = true;
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          if (done) return;
          done = true;
          cleanup();
          reject(error);
        },
      );
    });
  });
}
