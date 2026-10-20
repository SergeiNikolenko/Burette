export type FileBatchProgress = {
  total: number;
  completed: number;
  opened: number;
  failures: { path: string; message: string }[];
  cancelled: boolean;
  documentId?: string;
};

/** Keep at most three transfers ahead of the serial viewer import. A slow
 * renderer must not download an entire folder into the preview cache. */
export async function runFileQueue(paths: string[], options: {
  resolvePath: (path: string) => Promise<string>;
  open: (path: string) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: FileBatchProgress) => void;
}): Promise<FileBatchProgress> {
  const unique = [...new Set(paths)];
  if (unique.length > 200) throw new Error("Choose up to 200 files at a time.");
  const progress: FileBatchProgress = { total: unique.length, completed: 0, opened: 0, failures: [], cancelled: false };
  const publish = () => options.onProgress?.({ ...progress, failures: [...progress.failures] });
  type Result = { ok: true; path: string } | { ok: false; error: unknown };
  const pending = new Map<number, Promise<Result>>();
  const start = (index: number) => {
    if (index >= unique.length || options.signal?.aborted) return;
    pending.set(index, Promise.resolve().then(() => {
      options.signal?.throwIfAborted();
      return options.resolvePath(unique[index]);
    }).then(path => ({ ok: true as const, path }), error => ({ ok: false as const, error })));
  };
  publish();
  for (let index = 0; index < Math.min(3, unique.length); index++) start(index);
  for (let index = 0; index < unique.length && !options.signal?.aborted; index++) {
    const result = await pending.get(index)!;
    pending.delete(index);
    if (options.signal?.aborted) break;
    try {
      if (!result.ok) throw result.error;
      await options.open(result.path);
      progress.opened++;
    } catch (error) {
      if (options.signal?.aborted) break;
      progress.failures.push({ path: unique[index], message: String(error) });
    }
    progress.completed++;
    publish();
    start(index + 3);
  }
  progress.cancelled = options.signal?.aborted ?? false;
  publish();
  return progress;
}
