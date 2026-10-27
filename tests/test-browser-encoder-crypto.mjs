import assert from 'node:assert/strict';
import { randomBytes } from '../scripts/browser-encoder-crypto.mjs';
import { browserEncoderCryptoPlugin, assertNoLegacyBrowserCrypto } from '../scripts/browser-encoder-crypto-plugin.mjs';

assert.equal(randomBytes(0).length, 0);
assert.equal(randomBytes(1).length, 1);
assert.equal(randomBytes(131073).length, 131073);
for (const value of [-1, 1.5, NaN, Infinity, '1']) {
  assert.throws(() => randomBytes(value), RangeError);
}
const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
try {
  const lengths = [];
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    getRandomValues(view) { lengths.push(view.length); view.fill(37); return view; },
  } });
  assert.equal(randomBytes(131073).every(byte => byte === 37), true);
  assert.deepEqual(lengths, [65536, 65536, 1]);
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  assert.throws(() => randomBytes(1));
} finally {
  if (original) Object.defineProperty(globalThis, 'crypto', original);
  else delete globalThis.crypto;
}
const plugin = await browserEncoderCryptoPlugin(process.cwd());
let resolver;
plugin.setup({ onResolve(_, callback) { resolver = callback; } });
assert.throws(() => resolver({ importer: '/unreviewed/consumer.js' }), /Unexpected browser crypto consumer/);
assert.throws(() => assertNoLegacyBrowserCrypto('name:"elliptic"'), /Legacy elliptic/);
assertNoLegacyBrowserCrypto('globalThis.crypto.getRandomValues(bytes)');
console.log('Encoder CSPRNG adapter bounds, fail-closed behavior and dependency guard passed.');
