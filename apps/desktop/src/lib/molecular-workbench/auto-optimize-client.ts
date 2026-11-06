import type { AutoOptimizeFrame, AutoOptimizeMessage, AutoOptimizeRequest } from './auto-optimize-worker';
import type { Vec3 } from './types';
export type { AutoOptimizeFrame } from './auto-optimize-worker';

export type AutoOptimizeSession = {
  /** The dragged atoms hold these positions until `release`; the rest relax around them. */
  move(atoms: number[], positions: Vec3[]): void;
  release(): void;
  /** Terminates the worker; frames stop arriving. */
  stop(): void;
};

/** One worker per session; it keeps relaxing the structure until stopped. */
export function startAutoOptimize(request: Extract<AutoOptimizeRequest, { type: 'start' }>, onFrame: (frame: AutoOptimizeFrame) => void, onError: (message: string) => void): AutoOptimizeSession {
  const worker = new Worker(new URL('./auto-optimize-worker.ts', import.meta.url), { type: 'module' });
  let stopped = false;
  worker.onmessage = (event: MessageEvent<AutoOptimizeMessage>) => {
    if (stopped) return;
    if ('frame' in event.data) onFrame(event.data.frame);
    else onError(event.data.error);
  };
  worker.onerror = event => { if (!stopped) onError(event.message || 'Auto Optimize failed.'); };
  worker.postMessage(request);
  const send = (message: AutoOptimizeRequest) => { if (!stopped) worker.postMessage(message); };
  return {
    move: (atoms, positions) => send({ type: 'move', atoms, positions }),
    release: () => send({ type: 'release' }),
    stop() { stopped = true; worker.terminate(); },
  };
}
