import type { GraphRequest, GraphResults } from './graph-operations';
import { runWorkerTask, type WorkerTaskOptions } from './worker-task';

/** Graph IO and edits never load forcefields, optimizers or quantum operations. */
export function runGraphTask<T extends GraphRequest>(request: T, options: WorkerTaskOptions = {}): Promise<GraphResults[T['action']]> {
  return runWorkerTask(() => new Worker(new URL('./graph-worker.ts', import.meta.url), { type: 'module' }), request, options);
}
