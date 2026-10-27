import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the reviewed h264 Emscripten fallback is allowed to use this adapter.
// Other Node crypto consumers must be reviewed, not silently weakened.
export async function browserEncoderCryptoPlugin(root) {
  const require = createRequire(await realpath(resolve(root, 'node_modules/molstar/package.json')));
  const encoder = require.resolve('h264-mp4-encoder');
  const source = await readFile(encoder, 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== 'f8df9c1791b249f75e5cef77f8e32a135b4cdb2c918a0c4593669e8571085c0c'
      || (source.match(/require\("crypto"\)/g) || []).length !== 1
      || (source.match(/\.randomBytes\(/g) || []).length !== 1
      || !source.includes('I.randomBytes(1)[0]')) {
    throw new Error('Review changed h264 encoder crypto usage');
  }
  return { name: 'encoder-platform-crypto', setup(build) {
    build.onResolve({ filter: /^(node:)?crypto$/ }, args => {
      if (args.importer !== encoder) throw new Error(`Unexpected browser crypto consumer: ${args.importer}`);
      return { path: resolve(dirname(fileURLToPath(import.meta.url)), 'browser-encoder-crypto.mjs') };
    });
  } };
}

export function assertNoLegacyBrowserCrypto(code) {
  if (/name:["']elliptic["']|EC cryptography|secp256k1/.test(code)) {
    throw new Error('Legacy elliptic crypto remains in browser runtime');
  }
}
