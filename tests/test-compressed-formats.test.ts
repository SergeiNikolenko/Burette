import { expect, test } from "bun:test";
import { assertSignatureMatches, compressedName, compressionFromSignature, nestedArchiveSignature, supportedCompressedName } from "../apps/desktop/src/lib/compressed-files/formats";

test("compressed names retain the actual inner format and a writable copy name", () => {
  const files = ["/disk/Molecule.SDF.XZ", "C:\\data\\protein.pdb.bgzf", "cell.mcif.zstd", "model.maegz", "water.fchk.gz", "molden.input.gz"];
  expect(files.map(name => {
    const parsed = supportedCompressedName(name);
    return [parsed.codec, parsed.innerName, parsed.innerExtension, parsed.exportName];
  })).toEqual([
    ["xz", "Molecule.SDF", "sdf", "Molecule.SDF.xz"], ["gzip", "protein.pdb", "pdb", "protein.pdb.gz"],
    ["zstd", "cell.mcif", "mcif", "cell.mcif.zstd"], ["gzip", "model.mae", "mae", "model.maegz"],
    ["gzip", "water.fchk", "fchk", "water.fchk.gz"], ["gzip", "molden.input", "input", "molden.input.gz"],
  ]);
  expect(compressedName("plain.sdf")).toBeNull();
  for (const [name, reason] of [["missing.gz", "does not name"], ["bundle.tar.xz", ".tar files"], ["trajectory.xtc.zst", ".xtc files"], ["nested.sdf.gz.zst", "more than once"]]) {
    expect(() => supportedCompressedName(name)).toThrow(reason);
  }
});

test("signatures distinguish compression, nesting and ordinary ASCII text", () => {
  const signatures = [
    [0x1f, 0x8b], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0],
    [0x28, 0xb5, 0x2f, 0xfd], [0x5f, 0x2a, 0x4d, 0x18],
  ].map(bytes => Uint8Array.from(bytes));
  expect(signatures.map(compressionFromSignature)).toEqual(["gzip", "xz", "zstd", "zstd"]);
  expect(signatures.map(nestedArchiveSignature)).toEqual(Array(4).fill("compressed data"));
  expect(() => assertSignatureMatches("cell.cif.gz", signatures[1], "gzip")).toThrow("contains XZ data");
  const ascii = new TextEncoder();
  expect(nestedArchiveSignature(ascii.encode("BZh9 atom label"))).toBeNull();
  expect(nestedArchiveSignature(ascii.encode("BZh91AY&SY"))).toBe("bzip2 data");
  expect(() => assertSignatureMatches("plain.sdf.xz", ascii.encode("Molecule\n"), "xz")).toThrow("not XZ data");
  expect(nestedArchiveSignature(Uint8Array.from([0x50, 0x4b, 3, 4]))).toBe("a ZIP archive");
});
