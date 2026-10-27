// Emscripten's h264 encoder only needs randomBytes for /dev/random fallback.
// Use the platform CSPRNG instead of Bun's complete legacy crypto polyfill.
export function randomBytes(size) {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid random byte count');
  const bytes = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += 65536) {
    globalThis.crypto.getRandomValues(bytes.subarray(offset, Math.min(size, offset + 65536)));
  }
  return bytes;
}
