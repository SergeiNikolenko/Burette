import { open, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const chunkBytes = 192 * 1024;
const installedRoot = fileURLToPath(new URL('../assets/native-workspace/', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../plugins/burette-agent/assets/native-workspace/', import.meta.url));

// Only build-manifest entries are addressable. Never interpret an asset request
// as a filesystem path, and never expose packed bytes to model-visible output.
export async function readMcpAppAsset(request, assetsRoot) {
  const root = assetsRoot || await realpath(installedRoot).catch(() => sourceRoot);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (request.manifest === true) return { manifest };
  const entry = Object.hasOwn(manifest.assets, request.path) ? manifest.assets[request.path] : null;
  if (!entry || !/^[a-f0-9]{64}$/u.test(entry.sha256)) throw new Error('Unknown packaged workspace asset.');
  const offset = request.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= entry.packedBytes) throw new Error('Invalid asset offset.');
  const path = await realpath(join(root, `${entry.sha256}.gz`));
  if (path !== resolve(await realpath(root), `${entry.sha256}.gz`)) throw new Error('Packaged asset must not be a symbolic link.');
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== entry.packedBytes || info.size > 24 * 1024 * 1024) throw new Error('Invalid packaged asset size.');
    const bytes = Buffer.alloc(Math.min(chunkBytes, info.size - offset));
    let read = 0;
    while (read < bytes.length) {
      const part = await handle.read(bytes, read, bytes.length - read, offset + read);
      if (!part.bytesRead) throw new Error('Packaged asset is truncated.');
      read += part.bytesRead;
    }
    return { dataBase64: bytes.toString('base64'), nextOffset: offset + read < info.size ? offset + read : null };
  } finally { await handle.close(); }
}
