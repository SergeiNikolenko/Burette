/** Loader for the standalone symmetry WebAssembly modules built by
 * compute/symmetry-wasm/build-wasm.sh. They need only a few WASI imports:
 * stderr writes from unreachable libmsym branches, an empty environment for
 * spglib's optional SPGLIB_NUM_ATTEMPTS lookup, and a memory-growth notice. */

const WASI_ERRNO_BADF = 8;

export type StandaloneWasm = {
  exports: WebAssembly.Exports & { memory: WebAssembly.Memory; malloc(size: number): number; free(pointer: number): void };
  /** Text the module wrote to stdout/stderr, kept for error reports. */
  diagnostics(): string;
};

export async function instantiateStandaloneWasm(source: BufferSource | URL): Promise<StandaloneWasm> {
  const bytes = source instanceof URL ? await fetchWasm(source) : source;
  let memory: WebAssembly.Memory | undefined;
  const output = new Uint8Array(4096);
  let outputLength = 0;
  const view = () => new DataView(memory!.buffer);
  const wasi = {
    fd_write(fd: number, iovs: number, count: number, written: number) {
      if (fd !== 1 && fd !== 2) return WASI_ERRNO_BADF;
      const data = view();
      let total = 0;
      for (let index = 0; index < count; index++) {
        const pointer = data.getUint32(iovs + index * 8, true);
        const length = data.getUint32(iovs + index * 8 + 4, true);
        const capture = Math.min(length, output.length - outputLength);
        if (capture > 0) {
          const bytes = new Uint8Array(memory!.buffer, pointer, length);
          output.set(bytes.subarray(0, capture), outputLength);
          outputLength += capture;
        }
        total += length;
      }
      data.setUint32(written, total, true);
      return 0;
    },
    fd_close: () => WASI_ERRNO_BADF,
    fd_seek: () => WASI_ERRNO_BADF,
    environ_sizes_get(count: number, size: number) {
      view().setUint32(count, 0, true);
      view().setUint32(size, 0, true);
      return 0;
    },
    environ_get: () => 0,
  };
  const module = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi, env: { emscripten_notify_memory_growth() {} } });
  const exports = instance.exports as StandaloneWasm["exports"] & { _initialize?: () => void };
  memory = exports.memory;
  exports._initialize?.();
  return { exports, diagnostics: () => new TextDecoder().decode(output.subarray(0, outputLength)) };
}

async function fetchWasm(url: URL) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The symmetry engine could not be loaded (${response.status}).`);
  return response.arrayBuffer();
}

export function readCString(memory: WebAssembly.Memory, pointer: number, limit = 1024) {
  const bytes = new Uint8Array(memory.buffer, pointer, Math.min(limit, memory.buffer.byteLength - pointer));
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(bytes.subarray(0, end < 0 ? bytes.length : end));
}
