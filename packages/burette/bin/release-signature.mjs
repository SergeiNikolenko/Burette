import { createPublicKey, verify } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

// Public Sparkle release key, independently pinned in the installer source.
// Rotation requires a reviewed installer update, never downloaded metadata.
export const RELEASE_PUBLIC_KEY = readFileSync(new URL('./release-signing-key.txt', import.meta.url), 'utf8').trim();
export const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

export async function verifyReleaseArchive(filePath, signatureText, publicKey = RELEASE_PUBLIC_KEY) {
  const signature = signatureText.trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) {
    throw new Error('Release archive signature is missing or malformed.');
  }
  const size = (await stat(filePath)).size;
  if (size === 0 || size > MAX_ARCHIVE_BYTES) throw new Error('Release archive size is invalid.');
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]),
    format: 'der', type: 'spki',
  });
  if (!verify(null, await readFile(filePath), key, Buffer.from(signature, 'base64'))) {
    throw new Error('Release archive is not signed by the trusted Burette publisher.');
  }
}
