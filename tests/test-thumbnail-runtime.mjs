#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("SKIP thumbnail runtime: requires macOS QuickLookThumbnailing.");
  process.exit(0);
}

const source = await readFile(new URL("../PreviewExtension/ThumbnailProvider.swift", import.meta.url), "utf8");
// Compile the complete production provider. A same-file extension can exercise
// its private parsers without adding test-only production APIs.
const harness = String.raw`
extension ThumbnailProvider {
    static func verifyRuntime() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("small.xyz")
        try Data("2\n\nC 0 0 0\nO 1.2 0 0\n".utf8).write(to: url)
        assert(readSmallMolecule(fileURL: url, fileExtension: "xyz")?.count == 2)
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: 1024 * 1024 * 1024)
        try handle.close()
        assert(readSmallMolecule(fileURL: url, fileExtension: "xyz") == nil)

        func cube(_ count: String, _ axisCount: String = "1") -> String {
            "\n\n\(count) 0 0 0\n\(axisCount) 1 0 0\n\(axisCount) 0 1 0\n\(axisCount) 0 0 1\n6 0 0 0 0\n8 0 2 0 0\n"
        }
        assert(parseCube(cube(String(Int.min))) == nil)
        assert(parseCube(cube(String(Int.max))) == nil)
        assert(parseCube(cube("241")) == nil)
        assert(parseCube(cube("2"))?.count == 2, "Blank comment lines must retain their positions")
        assert(abs(parseCube(cube("-2"))![1].x - 1.058354421806) < 1e-10, "Negative atom counts still use Bohr axes")
        assert(parseCube(cube("2", "-1"))![1].x == 2, "Negative axis counts already use Angstrom")

        let row = "    1" + "MOL  " + "    C" + "    1" + String(format: "%8.3f%8.3f%8.3f%8.4f%8.4f%8.4f", 0.1, 0.2, 0.3, 4.0, 5.0, 6.0)
        let gro = "\n2\n\(row)\n\(row)\n1 1 1\n"
        let atoms = parseGRO(gro)!
        assert(atoms.count == 2)
        assert(atoms[0].x == 1 && atoms[0].y == 2 && atoms[0].z == 3, "Velocities must not replace coordinates")
        assert(atoms[0].element == "C")
        print("Thumbnail runtime: bounded reads, CUBE bounds/units, blank headers, and GRO velocities passed")
    }
}
try ThumbnailProvider.verifyRuntime()
`;
const directory = await mkdtemp(path.join(tmpdir(), "burette-thumbnail-runtime-"));
try {
  const file = path.join(directory, "main.swift");
  const binary = path.join(directory, "thumbnail-tests");
  await writeFile(file, source + harness);
  const compile = spawnSync("xcrun", ["swiftc", file, "-o", binary], { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(compile.status, 0, compile.error?.message || compile.stderr);
  const run = spawnSync(binary, [], { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(run.status, 0, run.error?.message || run.stderr);
  console.log(run.stdout.trim());
} finally {
  await rm(directory, { recursive: true, force: true });
}
