import { parseGIF, decompressFrames } from "gifuct-js";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

export type AnimationFrames = { width: number; height: number; frames: Uint8ClampedArray[] };

// The alpha byte of an RGBA pixel read as one platform-endian 32-bit word.
const ALPHA_MASK = new Uint8Array(new Uint32Array([0xff]).buffer)[0] === 0xff ? 0xff000000 : 0xff;

// Materialize composited frames, respecting optimized GIF patches and disposal.
export function decodeAnimation(bytes: ArrayBuffer): AnimationFrames {
  const parsed = parseGIF(bytes);
  const { width, height } = parsed.lsd;
  const count = parsed.frames.filter(frame => "image" in frame).length;
  if (!count || count > 240 || width * height * count > 100_000_000) throw new Error("Animation is too large for editing. Use fewer frames or a smaller image.");
  let screen = new Uint8ClampedArray(width * height * 4);
  const frames = decompressFrames(parsed, true).map(frame => {
    const before = frame.disposalType === 3 ? screen.slice() : null;
    const { left, top, width: w, height: h } = frame.dims;
    // Copy whole RGBA pixels; a subarray per pixel cost about a second for a
    // default 120-frame preview. A zero alpha byte keeps the pixel beneath.
    const pixels = new Uint32Array(screen.buffer);
    const patch = new Uint32Array(frame.patch.slice().buffer, 0, w * h);
    const columns = Math.min(w, width - left);
    for (let y = 0; y < h && top + y < height; y++) {
      const src = y * w;
      const dst = (top + y) * width + left;
      for (let x = 0; x < columns; x++) {
        const value = patch[src + x];
        if (value & ALPHA_MASK) pixels[dst + x] = value;
      }
    }
    const result = screen.slice();
    if (before) screen = before;
    else if (frame.disposalType === 2) for (let y = 0; y < h && top + y < height; y++) {
      screen.fill(0, ((top + y) * width + left) * 4, ((top + y) * width + Math.min(width, left + w)) * 4);
    }
    return result;
  });
  return { width, height, frames };
}

export async function encodeAnimation(animation: AnimationFrames, start: number, end: number, fps: number, progress: (value: number) => void, signal?: AbortSignal) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= animation.frames.length || end < start || !Number.isFinite(fps) || fps < 1 || fps > 120) throw new Error("Invalid export range or frame rate.");
  const gif = GIFEncoder();
  // GIF readers commonly clamp sub-20 ms delays. Resample faster previews
  // to at most 50 fps while preserving their duration, rather than slowing them.
  const duration = (end - start + 1) / fps;
  const outputCount = Math.max(1, Math.min(end - start + 1, Math.round(duration * 50)));
  for (let output = 0; output < outputCount; output++) {
    const index = start + Math.min(end - start, Math.floor(output * (end - start + 1) / outputCount));
    signal?.throwIfAborted();
    const rgba = animation.frames[index];
    const palette = quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true });
    const transparentIndex = palette.findIndex(color => color[3] === 0);
    gif.writeFrame(applyPalette(rgba, palette, "rgba4444"), animation.width, animation.height, {
      palette, delay: Math.max(2, Math.round((output + 1) * duration * 100 / outputCount) - Math.round(output * duration * 100 / outputCount)) * 10, repeat: 0, dispose: 2,
      transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex),
    });
    progress((output + 1) / outputCount);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  gif.finish();
  return gif.bytes();
}
