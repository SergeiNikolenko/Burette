import { parseGIF, decompressFrames } from "gifuct-js";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

export type AnimationFrames = { width: number; height: number; frames: Uint8ClampedArray[] };

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
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (left + x >= width || top + y >= height) continue;
      const src = (y * w + x) * 4;
      const dst = ((top + y) * width + left + x) * 4;
      if (frame.patch[src + 3]) screen.set(frame.patch.subarray(src, src + 4), dst);
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
