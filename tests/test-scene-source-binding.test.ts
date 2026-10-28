import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sha256Hex, positionsMatch } from "../apps/desktop/src/lib/source-editing/source-identity";
import { ScienceSessionError } from "../apps/desktop/src/lib/science-session/contracts";
import { readSceneSourceFrames, readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { checkBindingReport, checkSceneShowsSource } from "../apps/desktop/src/lib/science-session/scene-binding";
import { readSdfSource } from "../apps/desktop/src/lib/science-session/sdf-source";
import { readGraphMetadata, graphMetadataData } from "../apps/desktop/src/lib/workbench/graph-metadata";
import { checkMeasurementSource, readMeasurementRequest } from "../apps/desktop/src/lib/workbench/measurement-request";

const xyz = "2\r\nframe 1\r\n6 0 0 0 extra\r\nO 1 0 0\r\n2\nframe 2\nC 0 1 0\n8 1 1 0\n";
const sdf = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8");
const refs = { structureRef: "structure", modelRef: "model", trajectoryRef: "trajectory" };

test("raw identity includes BOM, line endings and the exact byte view; positions retain float32 tolerance", async () => {
  expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const raw = new TextEncoder().encode("prefix\uFEFFsource\r\npostfix"), view = raw.subarray(6, raw.length - 7);
  expect(await sha256Hex(view)).toBe(createHash("sha256").update(view).digest("hex"));
  expect(await sha256Hex("\uFEFFsource\r\n")).not.toBe(await sha256Hex("source\n"));
  expect(positionsMatch([0, 1, 2], Float32Array.of(0.0009, 1, 2))).toBe(true);
  expect(positionsMatch([0, 1, 2], [0.0011, 1, 2])).toBe(false);
  expect(positionsMatch([0], [NaN])).toBe(false);
  expect(positionsMatch([0], [0, 1])).toBe(false);
});

test("shared frames and binding preserve source order and the reported frame, with one error class", () => {
  const frames = readXyzFrames(xyz);
  expect(frames).toEqual([
    { elements: ["C", "O"], positions: Float64Array.of(0, 0, 0, 1, 0, 0) },
    { elements: ["C", "O"], positions: Float64Array.of(0, 1, 0, 1, 1, 0) },
  ]);
  const report = checkBindingReport({ ...refs, atomCount: 2, frameCount: 2, frameIndex: 1, elements: ["c", "8"], positions: Array.from(frames[1].positions) });
  expect(checkSceneShowsSource(report, xyz)).toEqual(frames);
  for (const changed of [{ ...report, frameIndex: 0 }, { ...report, frameCount: 1 }, { ...report, elements: ["O", "C"] }]) {
    try { checkSceneShowsSource(changed, xyz); throw new Error("accepted stale binding"); }
    catch (error) { expect(error).toBeInstanceOf(ScienceSessionError); expect((error as ScienceSessionError).code).toBe("binding"); }
  }
  expect(() => readXyzFrames(xyz.replace("8 1 1 0", "N 1 1 0"))).toThrow("changes its atoms");
  expect(() => checkBindingReport({ ...report, positions: [NaN, 0, 0, 0, 0, 0] })).toThrow(ScienceSessionError);
});

test("SDF uses the explicit graph reader and still validates reserved metadata before binding", () => {
  const metadata = readGraphMetadata("", 3), tagged = sdf.replace("$$$$", graphMetadataData("", metadata) + "\n\n$$$$");
  const source = readSdfSource(tagged), frames = readSceneSourceFrames(tagged, "sdf");
  expect(source.atomIds).toEqual(metadata.atoms.map(atom => atom.id));
  expect(frames[0]).toEqual(source);
  const report = checkBindingReport({ ...refs, atomCount: 3, frameCount: 1, frameIndex: 0, elements: source.elements, positions: source.positions });
  expect(checkSceneShowsSource(report, tagged, "sdf")).toEqual(frames);
  const malformed = tagged.replace(metadata.atoms[1].id, metadata.atoms[0].id);
  expect(() => readSceneSourceFrames(malformed, "sdf")).toThrow("metadata");
  expect(() => checkSceneShowsSource(report, sdf + sdf, "sdf")).toThrow("one SDF record");
});

test("measurement checks keep exact raw hashes, refs, frame, order, coordinates and both explicit formats", async () => {
  const source = readSdfSource(sdf);
  for (const format of ["sdf", "mol"] as const) {
    const text = format === "sdf" ? sdf : sdf.split("$$$$")[0];
    const report = { ...refs, atomCount: 3, frameCount: 1, frameIndex: 0, elements: source.elements, positions: source.positions,
      sourceFormat: format, sourceSha256: await sha256Hex(text) };
    const request = readMeasurementRequest({ ...report, kind: "distance", atoms: [2, 0] })!;
    expect(request.atoms).toEqual([2, 0]);
    await checkMeasurementSource(request, text, report);
    await expect(checkMeasurementSource(request, text + "\n", report)).rejects.toThrow("changed");
    for (const changed of [{ ...report, modelRef: "replacement" }, { ...report, frameCount: 2 },
      { ...report, elements: ["C", "O", "C"] }, { ...report, positions: Float64Array.from(source.positions, value => value + 0.01) },
      { ...report, sourceFormat: format === "mol" ? "sdf" : "mol" }]) {
      await expect(checkMeasurementSource(request, text, changed)).rejects.toThrow();
    }
  }
});

test("the actual measurement browser bundle does not load scientific archives or compute implementations", async () => {
  const loaded: string[] = [];
  const result = await Bun.build({
    entrypoints: [new URL("../apps/desktop/src/lib/workbench/measurement-request.ts", import.meta.url).pathname], target: "browser", write: false,
    plugins: [{ name: "record-real-measurement-imports", setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/u }, ({ path }) => { loaded.push(path.replaceAll("\\", "/")); });
    } }],
  });
  expect(result.success).toBe(true);
  expect(loaded.some(path => path.endsWith("/scene-binding.ts"))).toBe(true);
  expect(loaded.some(path => path.endsWith("/molecular-graph.ts"))).toBe(true);
  expect(loaded.filter(path => /\/(?:science-session\/(?:codec|export)|molecular-workbench\/(?:chemistry|quantum|forcefield|optimization))\.[cm]?[jt]s$/u.test(path))).toEqual([]);
});
