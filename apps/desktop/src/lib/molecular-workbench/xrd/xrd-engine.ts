import type { XrdEngineExports } from "./powder-xrd";

/** Engine identity written into exported data; matches compute/xrd-wasm/build-wasm.sh. */
export const XRD_ENGINE = "Gemmi 0.7.5 (5cc1c23c, MPL-2.0) structure factors, burette-xrd.wasm";

/** Instantiates the standalone burette-xrd.wasm; its only import is a memory-growth notice. */
export async function loadXrdEngine(source: BufferSource | URL): Promise<XrdEngineExports> {
  let bytes: BufferSource;
  if (source instanceof URL) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`The diffraction engine could not be loaded (${response.status}).`);
    bytes = await response.arrayBuffer();
  } else {
    bytes = source;
  }
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(bytes), { env: { emscripten_notify_memory_growth() {} } });
  const exports = instance.exports as XrdEngineExports & { _initialize?: () => void };
  exports._initialize?.();
  return exports;
}
