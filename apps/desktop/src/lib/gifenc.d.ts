declare module "gifenc" {
  export function quantize(rgba: Uint8ClampedArray, count: number, options: { format: "rgba4444"; oneBitAlpha: boolean }): number[][];
  export function applyPalette(rgba: Uint8ClampedArray, palette: number[][], format: "rgba4444"): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(pixels: Uint8Array, width: number, height: number, options: { palette: number[][]; delay: number; repeat: number; transparent: boolean; transparentIndex: number; dispose: number }): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  };
}
