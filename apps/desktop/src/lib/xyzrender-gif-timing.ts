// Change playback timing without decoding pixels or quantizing their colours.
// Faster rates need frame resampling and use the normal encoder instead.
export function retimeGif(bytes: Uint8Array, fps: number): Uint8Array | null {
  if (!Number.isFinite(fps) || fps < 1 || fps > 50) return null;
  if (bytes.length < 14 || !/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.subarray(0, 6)))) return null;
  const word = (offset: number) => bytes[offset] | bytes[offset + 1] << 8;
  const pixels = word(6) * word(8);
  const delays: number[] = [];
  let offset = 13 + (bytes[10] & 128 ? 3 * (2 << (bytes[10] & 7)) : 0);
  let delay: number | null = null;
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (!size) return true;
      offset += size;
    }
    return false;
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) {
      if (!delays.length || delays.length > 240 || pixels * delays.length > 100_000_000) return null;
      const result = bytes.slice();
      delays.forEach((position, frame) => {
        const duration = Math.max(2, Math.round((frame + 1) * 100 / fps) - Math.round(frame * 100 / fps));
        result[position] = duration & 255;
        result[position + 1] = duration >> 8;
      });
      return result;
    }
    if (marker === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9) {
        if (bytes[offset] !== 4 || offset + 6 > bytes.length || bytes[offset + 5] !== 0) return null;
        delay = offset + 2;
      }
      // Plain text also consumes a graphics control extension; fall back to
      // the existing decoder for this unusual, non-renderer output.
      if (label === 0x01 || !skipBlocks()) return null;
    } else if (marker === 0x2c) {
      if (delay === null || offset + 9 > bytes.length) return null;
      delays.push(delay);
      delay = null;
      const packed = bytes[offset + 8];
      offset += 9 + (packed & 128 ? 3 * (2 << (packed & 7)) : 0);
      offset++; // LZW minimum code size
      if (!skipBlocks()) return null;
    } else return null;
  }
  return null;
}
