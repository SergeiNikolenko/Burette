import { pathExtension, preferredTextExtensions, structureAndTextExtensions, structureExtensions } from "./file-routing";
import { isSpectrumPath } from "./spectrum";
import { isTauriRuntime } from "./tauri";

export async function expandBrowserDevStructureBundles(paths: string[]) {
  if (isTauriRuntime()) return paths;
  const expanded: string[] = [];
  const seen = new Set<string>();
  const addPath = (path: string) => {
    if (!seen.has(path)) {
      seen.add(path);
      expanded.push(path);
    }
  };
  for (const path of paths) {
    addPath(path);
    if (!isStructureBundleCandidate(path)) continue;
    try {
      const response = await fetch(`/__burette/file-bundle?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      if (!response.ok) continue;
      const bundle = await response.json() as {
        kind?: string;
        primaryPath?: string;
        attachments?: Array<{ path?: string }>;
      };
      if (bundle.kind === "single") continue;
      if (bundle.primaryPath) addPath(bundle.primaryPath);
      for (const attachment of bundle.attachments ?? []) {
        if (attachment.path) addPath(attachment.path);
      }
    } catch {
      // Browser-dev companion discovery is opportunistic; opening the requested file still works.
    }
  }
  return expanded;
}

function isStructureBundleCandidate(path: string) {
  const extension = pathExtension(path);
  return Boolean(extension) && (
    structureExtensions.has(extension)
    || isXtbOptimizationTrajectoryLogPath(path)
    || isSpectrumPath(path, extension)
    || structureAndTextExtensions.has(extension)
    || preferredTextExtensions.has(extension)
  );
}

export function isXtbOptimizationTrajectoryLogPath(path: string) {
  return (path.split(/[\\/]/).filter(Boolean).pop() ?? "").toLowerCase() === "xtbopt.log";
}
