import { readBrowserSourceRecord, writeBrowserSourceRecord, type BrowserSourceCheckpoint } from "./browser-source-storage";
export { BROWSER_SOURCE_CHECKPOINT_BYTES, browserSourceSessionScope as browserSourceCheckpointScope, browserSourceOriginal as browserCheckpointOriginal } from "./browser-source-storage";
export type { BrowserSourceCheckpoint } from "./browser-source-storage";

export const readBrowserSourceCheckpoint = (path: string, scope?: string | null) => readBrowserSourceRecord("source-checkpoints", path, scope);
export const writeBrowserSourceCheckpoint = (target: { scope: string; path: string }, expectedId: string | null,
  next: BrowserSourceCheckpoint | null, isCurrent: () => boolean) => writeBrowserSourceRecord("source-checkpoints", target, expectedId, next, isCurrent);
