export type WorkerTaskOptions = { signal?: AbortSignal; timeoutMs?: number };

/** A private worker per operation, terminated even when cancellation interrupts synchronous work. */
export function runWorkerTask<Result>(createWorker: () => Worker, request: unknown, options: WorkerTaskOptions = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException('Calculation cancelled.', 'AbortError')); return; }
    const worker = createWorker();
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException('Calculation cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Calculation exceeded the browser time limit.')); }, options.timeoutMs ?? 120_000);
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => {
      cleanup();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Chemistry worker failed.')); };
    try { worker.postMessage(request); } catch (error) { cleanup(); reject(error); }
  });
}
