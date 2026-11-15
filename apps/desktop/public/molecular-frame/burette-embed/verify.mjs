#!/usr/bin/env node
// Verify the complete artifact before a host build. --write-pin records an
// intentionally updated artifact in the host's checked-in runtime metadata.
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const writePin = args[0] === '--write-pin';
const pinPath = args[writePin ? 1 : 0];
if (!pinPath || args.length !== (writePin ? 2 : 1)) {
  throw new Error('Usage: node verify.mjs [--write-pin] <host-runtime.json>');
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(resolve(root, 'manifest.json'));
const manifest = JSON.parse(bytes);
if (manifest.name !== 'burette-embed' || !/^[a-f0-9]{12}$/.test(manifest.version)) {
  throw new Error('Invalid Burette artifact manifest.');
}
for (const [name, expected] of Object.entries(manifest.files)) {
  if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(name) || name.split('/').some(part => part === '..' || part === '.')) {
    throw new Error(`Invalid artifact path: ${name}`);
  }
  const file = resolve(root, name);
  if (!(await lstat(file)).isFile() || digest(await readFile(file)) !== expected) {
    throw new Error(`Burette artifact checksum mismatch: ${name}`);
  }
}
const pin = { version: manifest.version, manifestSha256: digest(bytes) };
if (writePin) {
  await writeFile(resolve(pinPath), `${JSON.stringify(pin, null, 2)}\n`);
} else {
  const expected = JSON.parse(await readFile(resolve(pinPath), 'utf8'));
  if (expected.version !== pin.version || expected.manifestSha256 !== pin.manifestSha256) {
    throw new Error('The Burette artifact differs from the host runtime pin.');
  }
}
console.log(`Verified Burette ${manifest.version}, ${Object.keys(manifest.files).length} assets.`);
