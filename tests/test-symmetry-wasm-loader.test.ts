import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { instantiateStandaloneWasm, readCString, type StandaloneWasm } from "../apps/desktop/src/lib/molecular-workbench/symmetry/wasm-module";

const engineDirectory = new URL("../apps/desktop/src/lib/molecular-workbench/symmetry/", import.meta.url);
const names = ["burette-msym.wasm", "burette-niggli.wasm"] as const;
const bytes = (name: typeof names[number]) => Uint8Array.from(readFileSync(new URL(name, engineDirectory)));
const server = Bun.serve({ port: 0, fetch(request) {
  const name = new URL(request.url).pathname.slice(1);
  return names.includes(name as typeof names[number]) ? new Response(bytes(name as typeof names[number]))
    : name === "broken" ? new Response(new Uint8Array([0, 97, 115])) : new Response("Not found", { status: 404 });
} });
afterAll(() => { server.stop(true); });

type Msym = StandaloneWasm["exports"] & {
  burette_msym_analyze(count: number, charges: number, masses: number, xyz: number, preset: number, symmetrize: number): number;
  burette_msym_point_group(): number;
  burette_msym_operation_count(): number;
  burette_msym_release(): void;
};
function inspect(name: typeof names[number], wasm: StandaloneWasm) {
  if (name === "burette-msym.wasm") {
    const engine = wasm.exports as Msym, q = engine.malloc(12), m = engine.malloc(24), xyz = engine.malloc(72);
    try {
      new Int32Array(engine.memory.buffer, q, 3).set([8, 1, 1]);
      new Float64Array(engine.memory.buffer, m, 3).fill(0);
      new Float64Array(engine.memory.buffer, xyz, 9).set([0, 0, 0, .75, 0, .5, -.75, 0, .5]);
      expect(engine.burette_msym_analyze(3, q, m, xyz, 0, 0)).toBe(0);
      return [readCString(engine.memory, engine.burette_msym_point_group()), engine.burette_msym_operation_count()];
    } finally { engine.burette_msym_release(); engine.free(q); engine.free(m); engine.free(xyz); }
  }
  const engine = wasm.exports as StandaloneWasm["exports"] & { burette_niggli_reduce(pointer: number, eps: number): number };
  const pointer = engine.malloc(72);
  try {
    new Float64Array(engine.memory.buffer, pointer, 9).set([4, 3, 1, 0, 2, 1, 0, 0, 3]);
    expect(engine.burette_niggli_reduce(pointer, 1e-5)).toBe(1);
    return Array.from(new Float64Array(engine.memory.buffer, pointer, 9), value => value + 0);
  } finally { engine.free(pointer); }
}
// Existing independently generated Python spglib oblique-cell reference, in column-matrix storage.
const expected = (name: typeof names[number]) => name === "burette-msym.wasm" ? ["C2v", 4] : [-1, 1, 3, 2, 1, 2, 0, 3, 0];

for (const name of names) {
  test(`${name} loads from a real HTTP URL and exposes initialized scientific exports`, async () => {
    expect(inspect(name, await instantiateStandaloneWasm(new URL(name, server.url)))).toEqual(expected(name));
  });
  for (const kind of ["array-buffer", "uint8-subarray", "data-view"] as const) test(`${name} respects the exact ${kind} byte range`, async () => {
    const input = bytes(name), padded = new Uint8Array(input.byteLength + 33).fill(0xa5); padded.set(input, 17);
    const source = kind === "array-buffer" ? input.buffer : kind === "uint8-subarray"
      ? padded.subarray(17, 17 + input.byteLength) : new DataView(padded.buffer, 17, input.byteLength);
    expect(inspect(name, await instantiateStandaloneWasm(source))).toEqual(expected(name));
  });
}

test("WASI imports are available during one initialize call; diagnostics and C strings remain usable", async () => {
  const source = Uint8Array.from(readFileSync(new URL("fixtures/symmetry/loader-wasi.wasm", import.meta.url)));
  const wasm = await instantiateStandaloneWasm(source), memory = new DataView(wasm.exports.memory.buffer);
  expect(wasm.diagnostics()).toBe("ready\nready\n");
  expect([8, 12, 16, 20, 24, 28, 32, 40, 44, 52, 56].map(offset => memory.getUint32(offset, true)))
    .toEqual([6, 0, 0, 6, 0, 0, 8, 8, 8, 0, 0]);
  expect(readCString(wasm.exports.memory, 64)).toBe("ready\n");
  expect(readCString(wasm.exports.memory, 64, 5)).toBe("ready");
  (wasm.exports.emit as () => void)(); expect(wasm.diagnostics()).toBe("ready\nready\nready\n");
});

test("fetch and compile errors retain their original error categories", async () => {
  await expect(instantiateStandaloneWasm(new URL("missing", server.url))).rejects.toThrow("The symmetry engine could not be loaded (404).");
  await expect(instantiateStandaloneWasm(new URL("broken", server.url))).rejects.toBeInstanceOf(WebAssembly.CompileError);
  for (const source of [bytes("burette-msym.wasm").slice(0, -1), new Uint8Array([0, 97, 115])])
    await expect(instantiateStandaloneWasm(source)).rejects.toBeInstanceOf(WebAssembly.CompileError);
  for (const [name, error] of [["loader-init-error", WebAssembly.RuntimeError], ["loader-link-error", WebAssembly.LinkError]] as const) {
    const source = Uint8Array.from(readFileSync(new URL(`fixtures/symmetry/${name}.wasm`, import.meta.url)));
    await expect(instantiateStandaloneWasm(source)).rejects.toBeInstanceOf(error);
  }
});
