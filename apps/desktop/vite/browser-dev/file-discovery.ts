import { realpathSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

export type BrowserDevFileScan = {
  truncated: boolean;
  scannedEntries: number;
  scannedDirectories: number;
};

export type BrowserDevFileScanLimits = {
  maxDirectories: number;
  maxEntries: number;
  maxFiles: number;
};

type BrowserDevFileScanOptions = BrowserDevFileScanLimits & {
  allowedExtensions: Set<string>;
  fileExtension: (path: string) => string;
  includeFile?: (path: string) => boolean;
  maxFileBytes: number;
};

export function emptyBrowserDevFileScan(): BrowserDevFileScan {
  return { truncated: false, scannedEntries: 0, scannedDirectories: 0 };
}

export async function collectBrowserDevFiles(
  path: string,
  files: string[],
  options: BrowserDevFileScanOptions,
  scan = emptyBrowserDevFileScan(),
): Promise<BrowserDevFileScan> {
  if (scan.truncated) return scan;
  let info;
  try {
    info = await lstat(path);
  } catch (_) {
    return scan;
  }
  scan.scannedEntries += 1;
  if (scan.scannedEntries > options.maxEntries) {
    scan.truncated = true;
    return scan;
  }
  if (info.isSymbolicLink()) return scan;
  if (info.isDirectory()) {
    scan.scannedDirectories += 1;
    if (scan.scannedDirectories > options.maxDirectories) {
      scan.truncated = true;
      return scan;
    }
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await collectBrowserDevFiles(join(path, entry.name), files, options, scan);
      if (scan.truncated) break;
    }
    return scan;
  }
  if (!info.isFile() || info.size > options.maxFileBytes) return scan;
  if (!options.allowedExtensions.has(options.fileExtension(path))) return scan;
  if (options.includeFile && !options.includeFile(path)) return scan;
  files.push(path);
  if (files.length >= options.maxFiles) scan.truncated = true;
  return scan;
}

export function canonicalExistingPath(path: string) {
  let candidate = resolve(path);
  const missingSegments: string[] = [];
  while (true) {
    try {
      return resolve(realpathSync(candidate), ...missingSegments);
    } catch (_) {
      const parent = dirname(candidate);
      if (parent === candidate) return resolve(path);
      missingSegments.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

export function isBrowserDevPathAllowed(path: string, allowedRoots: string[]) {
  const canonicalPath = canonicalExistingPath(path);
  return allowedRoots.some((root) => {
    const relation = relative(root, canonicalPath);
    return relation === "" || (relation && !relation.startsWith("..") && !relation.startsWith("/"));
  });
}
