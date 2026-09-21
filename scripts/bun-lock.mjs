import { readFileSync } from 'node:fs';

function normalizeLockJson(source) {
  return source.replace(/,\s*([}\]])/g, '$1');
}

export function readBunLock(filePath = 'bun.lock') {
  return JSON.parse(normalizeLockJson(readFileSync(filePath, 'utf8')));
}

export function getBunPackageSnapshot(lockfile, packageName) {
  const entry = lockfile.packages?.[packageName];
  if (!entry) {
    throw new Error(`Missing ${packageName} in bun.lock.`);
  }

  const descriptor = entry[0];
  const integrity = entry[3];
  const versionIndex = descriptor.lastIndexOf('@');
  if (versionIndex <= 0) {
    throw new Error(`Could not extract version for ${packageName} from bun.lock.`);
  }
  if (!integrity) {
    throw new Error(`Missing integrity for ${packageName} in bun.lock.`);
  }

  return {
    version: descriptor.slice(versionIndex + 1),
    integrity,
  };
}
