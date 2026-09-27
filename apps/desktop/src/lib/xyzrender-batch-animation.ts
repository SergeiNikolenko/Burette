import { renderXyzrender } from "./xyzrender-transport";
import { decodeAnimation, encodeAnimation } from "./xyzrender-animation";

export function gifBytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

// Renders one structure straight to a looping GIF at the requested speed. Batch
// items run one at a time, so their decoded frames are never held together.
export async function renderAnimationGifDataUrl(request: Parameters<typeof renderXyzrender>[0], fps: number, signal: AbortSignal) {
  const response = await renderXyzrender(request, signal);
  const payload = await response.json();
  if (!response.ok || typeof payload.gifBase64 !== "string") throw new Error(payload.error || "The animation could not be rendered.");
  const animation = decodeAnimation(Uint8Array.from(atob(payload.gifBase64), char => char.charCodeAt(0)).buffer);
  const bytes = await encodeAnimation(animation, 0, animation.frames.length - 1, fps, () => {}, signal);
  return `data:image/gif;base64,${gifBytesToBase64(bytes)}`;
}
