import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readCoordinateInterchange, writeCoordinateInterchange } from "../scripts/coordinate-interchange.mjs";
import { runReaderTask } from "../apps/desktop/src/lib/workbench/reader-task";
import { readWorkbenchSource } from "../apps/desktop/src/lib/workbench/structure";
import recovered from "../docs/avogadro-parity-evidence/state-only-recovered-geometry.cif.json";
import type { ViewerDocument } from "../apps/desktop/src/types";

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

test("reopened scene Cartesian CIF uses the compiled molecular reader without a cell", async () => {
  const document = { id: "recovered", title: "recovered.cif", extension: "cif", renderer: "molstar" } as ViewerDocument;
  const result = await readWorkbenchSource(document, recovered.text);
  expect(result.cell).toBeNull();
  expect(result.atoms).toEqual([
    { element: "O", x: 0, y: 0, z: 0 },
    { element: "H", x: 0.765, y: 0, z: 0.592 },
    { element: "H", x: -0.765, y: 0, z: 0.592 },
  ]);
  expect(result.graphFormat).toBe("xyz");
  const flat = recovered.text.replaceAll("_atom_site.", "_atom_site_");
  expect((await readWorkbenchSource(document, flat)).atoms).toEqual(result.atoms);
  const crystal = "data_cell\n_cell_length_a 4\n_cell_length_b 5\n_cell_length_c 6\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n_space_group_IT_number 1\nloop_\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nC .25 .5 .75\n";
  const periodic = await readWorkbenchSource(document, crystal);
  expect(periodic.cell).not.toBeNull();
  expect(periodic.atoms[0].x).toBeCloseTo(1, 12);
  expect(periodic.atoms[0].y).toBeCloseTo(2.5, 12);
  expect(periodic.atoms[0].z).toBeCloseTo(4.5, 12);
});

test("molecular CIF rejects ambiguous or malformed atom sets rather than calculating a mixture", async () => {
  const read = (text: string) => runReaderTask({ action: "molecular-cif", text });
  for (const [text, message] of [
    [recovered.text.replace("H MOL 1 A 0", "H MOL 1 A 2"), "one CIF model"],
    [recovered.text.replace("H H MOL 1 . .", "H H MOL 1 A ."), "alternate conformation"],
    [recovered.text.replace("0.592 1 0", "0.592 0.5 0"), "fully occupied"],
    [recovered.text.replace("0.765 0", "NaN 0"), "finite Cartesian"],
    [recovered.text.replace("0.592 1 0 .", "0.592 1 0 1"), "charge-preserving"],
    [recovered.text.replace(". 2 H H", ". 2 Xx H"), "Unsupported CIF element"],
    [recovered.text + recovered.text.replace("data_MODEL", "data_OTHER"), "one Cartesian coordinate block"],
  ]) await expect(read(text)).rejects.toThrow(message);
  await expect(read("#".repeat(20_000_001))).rejects.toThrow("20 MB");
});

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
