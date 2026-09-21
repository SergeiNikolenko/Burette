import UTIF from "utif";

interface Ifd {
  t256?: number[];
  t257?: number[];
  width?: number;
  height?: number;
}
interface Utif {
  decode(buf: ArrayBuffer): Ifd[];
  decodeImage(buf: ArrayBuffer, ifd: Ifd): void;
  toRGBA8(ifd: Ifd): Uint8Array;
}
const utif = UTIF as Utif;

interface Req {
  id: number;
  buffer: ArrayBuffer;
  targetWidth: number;
}

const ctx = self as unknown as Worker;

ctx.onmessage = async (event: MessageEvent<Req>) => {
  const { id, buffer, targetWidth } = event.data;
  try {
    const ifds = utif.decode(buffer);
    if (!ifds.length) throw new Error("TIFF has no frames");
    const ifd = ifds[0];
    utif.decodeImage(buffer, ifd);
    const rgba = utif.toRGBA8(ifd);
    const width = ifd.t256?.[0] ?? ifd.width ?? 0;
    const height = ifd.t257?.[0] ?? ifd.height ?? 0;
    if (!width || !height) throw new Error("TIFF has no dimensions");

    const dw = Math.min(width, targetWidth);
    const dh = Math.max(1, Math.round((dw / width) * height));
    const pixels = new Uint8ClampedArray(rgba.length);
    pixels.set(rgba);
    const source = new ImageData(pixels, width, height);
    const bitmap = await createImageBitmap(source, {
      resizeWidth: dw,
      resizeHeight: dh,
      resizeQuality: "high",
    });
    const canvas = new OffscreenCanvas(dw, dh);
    const c = canvas.getContext("2d");
    if (!c) throw new Error("No 2d context");
    c.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/png" });
    ctx.postMessage({ id, ok: true, blob });
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
