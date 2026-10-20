import { workspaceStorageKey } from "./window-scope";

type ViewCheckpoint = { version: 1; revision: number; value: string };
type CheckpointStorage = Pick<Storage, "getItem" | "setItem">;

// Independent bounded records avoid serializing a 1,000-document registry on
// every camera move. Quota/readback failure never discards the in-memory view.
export function createRendererViewCheckpointStore(storage: () => CheckpointStorage | null) {
  const views = new Map<string, ViewCheckpoint>();
  const key = (path: string) => workspaceStorageKey(`burette.renderer-view.v1:${path}`);
  const read = (path: string) => {
    const memory = views.get(path);
    if (memory) return memory;
    try {
      const text = storage()?.getItem(key(path));
      if (!text || text.length > 9000) return null;
      const checkpoint = JSON.parse(text) as ViewCheckpoint;
      if (checkpoint.version !== 1 || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 1
        || typeof checkpoint.value !== "string" || checkpoint.value.length > 8192) return null;
      const value = JSON.parse(checkpoint.value);
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      return checkpoint;
    } catch { return null; }
  };
  return {
    read,
    save(path: string, value: unknown) {
      if (!value || typeof value !== "object" || Array.isArray(value) || !path || path.length > 4096) return false;
      let text: string;
      try { text = JSON.stringify(value); } catch { return false; }
      if (text.length > 8192) return false;
      const previous = read(path);
      const checkpoint: ViewCheckpoint = { version: 1, revision: (previous?.revision ?? 0) + 1, value: text };
      views.delete(path);
      views.set(path, checkpoint);
      if (views.size > 2048) views.delete(views.keys().next().value!);
      try {
        const serialized = JSON.stringify(checkpoint);
        const target = storage();
        if (!target) return false;
        target.setItem(key(path), serialized);
        return target.getItem(key(path)) === serialized;
      } catch { return false; }
    },
  };
}

const views = createRendererViewCheckpointStore(() => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
});

export function rememberRendererViewState(path: string, value: unknown) {
  return views.save(path, value);
}

export function rendererViewReloadOptions(path: string) {
  return { rendererViewState: views.read(path)?.value ?? null };
}
