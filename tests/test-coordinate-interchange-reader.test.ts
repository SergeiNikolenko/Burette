import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readCoordinateInterchange, writeCoordinateInterchange } from "../scripts/coordinate-interchange.mjs";
import { runReaderTask } from "../apps/desktop/src/lib/workbench/reader-task";

const built = await Bun.build({ entrypoints: [new URL("../apps/desktop/src/lib/workbench/reader-worker.ts", import.meta.url).pathname], target: "browser", format: "esm" });
if (!built.success) throw new AggregateError(built.logs, "Reader worker build failed");
const directory = mkdtempSync(join(tmpdir(), "coordinate-reader-")), file = join(directory, "worker.js");
await Bun.write(file, built.outputs[0]);
const NativeWorker = Worker;
class CompiledWorker extends NativeWorker {
  constructor(_url: string | URL, options?: WorkerOptions) { super(pathToFileURL(file), options); }
}
Object.defineProperty(globalThis, "Worker", { configurable: true, value: CompiledWorker });
afterAll(() => { Object.defineProperty(globalThis, "Worker", { configurable: true, value: NativeWorker }); unlinkSync(file); rmdirSync(directory); });
const definition = "C\nX 1 DX\nH 1 R 2 A\nF 1 +R 2 A 3 -P\n\nDX=1\nR=1.09\nA=109.5\nP=60\nUNUSED=-17.125\n";
const canonical = readCoordinateInterchange(definition, "zmat");
const pair = { ...canonical, atoms: canonical.atoms.map(({ element, x, y, z }) => ({ element, x: -y + 42.1234567890123, y: x - 12, z: z + 7 })) };
const read = (name: string, text: string) => runReaderTask({ action: "parse", name, text });

test("compiled reader retains exact absolute atoms, full definition and human frame metadata", async () => {
  for (const [name, format] of [["named.xyz", "xyz"], ["named.zmat", "zmat"], ["named.zmatrix", "zmat"]] as const) {
    const text = writeCoordinateInterchange(pair, format, "Energy=-1 Hartree user burette-import-123");
    const parsed = await read(name, text);
    expect(parsed).toEqual({ format, atoms: pair.atoms, referenceFrameIndex: 0,
      frames: [{ atoms: pair.atoms, comment: "Energy=-1 Hartree user burette-import-123", energyHartree: -1 }],
      modes: [], orbitals: [], internalCoordinates: pair.internalCoordinates });
    expect(parsed.atoms).toBe(parsed.frames[0].atoms);
  }
});

test("compiled reader refuses contradictory, malformed and oversized markers without bare-geometry fallback", async () => {
  const xyz = writeCoordinateInterchange(pair, "xyz"), zmat = writeCoordinateInterchange(pair, "zmat");
  for (const [name, text] of [
    ["bad.xyz", xyz.replace("V1=", "V2=")],
    ["bad.xyz", xyz + xyz],
    ["bad.xyz", xyz.replace("C 42.1234567890123", "C 42.1234567890124")],
    ["bad.zmat", zmat.replace(/UNUSED\s*=\s*-17\.125/u, "UNUSED = -17.126")],
    ["bad.xyz", "1\nBURETTE_INTERNAL_COORDINATES_V1=e30=\nH 0 0 0\n"],
    ["bad.zmatrix", zmat + "#".repeat(1024 * 1024)],
  ]) await expect(read(name, text)).rejects.toThrow();
});

test("ordinary multi-frame and extended XYZ retain their reader behavior and larger unmarked bounds", async () => {
  const plain = await read("plain.xyz", "1\nEnergy=-1 Hartree\nH 1 2 3\n1\nEnergy=-2 Hartree\nH 4 5 6\n");
  expect(plain.frames.map(({ atoms, energyHartree }) => ({ atoms, energyHartree }))).toEqual([
    { atoms: [{ element: "H", x: 1, y: 2, z: 3 }], energyHartree: -1 },
    { atoms: [{ element: "H", x: 4, y: 5, z: 6 }], energyHartree: -2 },
  ]);
  expect(plain.internalCoordinates).toBeUndefined(); expect(plain.referenceFrameIndex).toBe(0);
  const large = await read("ordinary.xyz", `1\n${"x".repeat(1024 * 1024 + 1)}\nH 1 2 3\n`);
  expect(large.atoms).toEqual([{ element: "H", x: 1, y: 2, z: 3 }]);
  const extended = await read("extended.xyz", '1\nProperties=species:S:1:pos:R:3:forces:R:3 force_unit=eV/Angstrom energy=-1\nH 1 2 3 .1 .2 .3\n');
  expect(extended.atoms).toEqual([{ element: "H", x: 1, y: 2, z: 3 }]);
  expect(extended.internalCoordinates).toBeUndefined();
});
