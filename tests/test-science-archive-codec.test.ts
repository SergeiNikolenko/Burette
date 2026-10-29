import { expect, test } from "bun:test";
import { zipSync, unzipSync, strToU8 } from "../apps/desktop/node_modules/fflate";
import { readFileSync } from "node:fs";
import { XYZ, waterScience } from "./scientific-data-fixture";
import { encodeScienceSession, decodeScienceSession, SCIENCE_MANIFEST_ASSET_ID, type EncodedScienceSession } from "../apps/desktop/src/lib/science-session/codec";
import { sha256Hex } from "../apps/desktop/src/lib/source-editing/source-identity";
import { readGraphMetadata, graphMetadataData } from "../apps/desktop/src/lib/workbench/graph-metadata";
const binding = { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: 3 };
const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e", original = Uint8Array.of(0x1f, 0x8b, 0xef, 0xbb, 0xbf, 13, 10, 0, 255);
const path = (id: string) => `assets/${id}`;
function archive(encoded: EncodedScienceSession) {
  return zipSync({ "state.json": strToU8('{"entries":[]}'), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, kind: "file", name: asset.name }]))),
    ...Object.fromEntries(encoded.assets.map(asset => [path(asset.id), asset.bytes])) });
}
async function encodedScience(text = XYZ) {
  return encodeScienceSession({ documentUuid: uuid, source: { extension: "xyz", text }, atomIds: ["a", "b", "c"], binding, science: waterScience(), original: { name: "water.out.gz", file: new Blob([original]) } });
}
async function editScience(bytes: Uint8Array, edit: (data: any) => void) {
  const files = unzipSync(bytes), manifest = JSON.parse(new TextDecoder().decode(files[path(SCIENCE_MANIFEST_ASSET_ID)]));
  const id = manifest.science.attachment, data = JSON.parse(new TextDecoder().decode(files[path(id)])); edit(data);
  const json = strToU8(JSON.stringify(data)), descriptor = manifest.attachments.find((item: { id: string }) => item.id === id);
  Object.assign(descriptor, { sha256: await sha256Hex(json), byteLength: json.length, count: json.length });
  files[path(id)] = json; files[path(SCIENCE_MANIFEST_ASSET_ID)] = strToU8(JSON.stringify(manifest)); return zipSync(files);
}

test("MOLX asset codec retains scientific arrays, source identity, original bytes and durable atom ids", async () => {
  const encoded = await encodedScience(), decoded = (await decodeScienceSession(archive(encoded)))!;
  expect(decoded.source).toEqual({ extension: "xyz", text: XYZ }); expect(decoded.binding).toEqual(binding);
  expect(decoded.documentUuid).toBe(uuid); expect(decoded.atomIds).toEqual(["a", "b", "c"]);
  expect(decoded.science).toEqual(waterScience());
  expect(decoded.science!.grid!.values).toBeInstanceOf(Float32Array);
  expect(decoded.science!.frames[0].hessian!.values).toBeInstanceOf(Float64Array);
  expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(original);
});

test("a checksum-valid MOLX attachment cannot bypass Hessian symmetry validation", async () => {
  const encoded = await encodedScience();
  const science = encoded.assets.find(asset => asset.id === encoded.manifest.science!.attachment)!;
  const data = JSON.parse(new TextDecoder().decode(science.bytes)) as { frames: { hessian: { values: Record<string, string> } }[] };
  const id = Object.values(data.frames[0].hessian.values)[0];
  const matrix = encoded.assets.find(asset => asset.id === id)!;
  new DataView(matrix.bytes.buffer, matrix.bytes.byteOffset, matrix.bytes.byteLength).setFloat64(9 * 8, 0.2, true);
  encoded.manifest.attachments.find(attachment => attachment.id === id)!.sha256 = await sha256Hex(matrix.bytes);
  encoded.assets.find(asset => asset.id === SCIENCE_MANIFEST_ASSET_ID)!.bytes = strToU8(JSON.stringify(encoded.manifest));
  await expect(decodeScienceSession(archive(encoded))).rejects.toMatchObject({ code: "science" });
});

test("checksum-valid scientific mutations still fail semantic validation, including geometry and Gaussian shells", async () => {
  const bytes = archive(await encodedScience());
  for (const edit of [
    (data: any) => { data.frames[0].atoms[0].x += 10; },
    (data: any) => { data.orbitals[0].coefficients[0] = "bad"; },
    (data: any) => { data.basis = [{ atomIndex: 0, kind: "s", spherical: false, exponents: [1], coefficients: [1] }]; },
    (data: any) => { data.frames[0].hessian.source = "unknown"; },
    (data: any) => { data.modes[0].ramanDepolarizationRatio = 2; },
  ]) await expect(decodeScienceSession(await editScience(bytes, edit))).rejects.toMatchObject({ code: "science" });
  const files = unzipSync(bytes), manifest = JSON.parse(new TextDecoder().decode(files[path(SCIENCE_MANIFEST_ASSET_ID)]));
  files[path(manifest.source.attachment)][0] ^= 1;
  await expect(decodeScienceSession(zipSync(files))).rejects.toMatchObject({ code: "attachment" });
  expect(await decodeScienceSession(zipSync({ "state.json": strToU8("{}") }))).toBeNull();
});

test("SDF graph metadata and exact Original bytes survive codec reopen without scientific-array substitution", async () => {
  const source = readFileSync(new URL("../samples/collections/sdf/single.sdf", import.meta.url), "utf8"), metadata = readGraphMetadata("", 3);
  const text = source.replace("$$$$", graphMetadataData("", metadata) + "\n\n$$$$"), ids = metadata.atoms.map(atom => atom.id);
  const originalBytes = new TextEncoder().encode("\uFEFF" + source.replaceAll("\n", "\r\n"));
  const encoded = await encodeScienceSession({ documentUuid: uuid, source: { extension: "sdf", text }, atomIds: ids, binding, science: null,
    original: { name: "ethanol.sdf", file: new Blob([originalBytes]) } });
  const decoded = (await decodeScienceSession(archive(encoded)))!;
  expect(decoded.source).toEqual({ extension: "sdf", text }); expect(decoded.atomIds).toEqual(ids); expect(decoded.science).toBeNull();
  expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(originalBytes);
});

test("codec browser dependency graph contains validation but no worker, readers or field evaluator", async () => {
  const loaded: string[] = [], result = await Bun.build({ entrypoints: [new URL("../apps/desktop/src/lib/science-session/codec.ts", import.meta.url).pathname], target: "browser",
    plugins: [{ name: "codec-dependency-proof", setup(build) { build.onLoad({ filter: /\.[cm]?[jt]sx?$/u }, ({ path }) => { loaded.push(path); }); } }] });
  expect(result.success).toBe(true); expect(loaded.some(path => path.endsWith("/scientific-document.ts"))).toBe(true);
  expect(loaded.filter(path => /\/(?:science-worker|science-task|quantum|gaussian|fchk|forcefield|optimization)\.[cm]?[jt]s$/u.test(path))).toEqual([]);
});

test("checksum-valid MOLX cannot substitute noncanonical atom or frame elements", async () => {
  const bytes = archive(await encodedScience()), outcomes: string[] = [];
  for (const alias of ["8", "o"]) for (const location of ["atoms", "frame"]) {
    const changed = await editScience(bytes, data => {
      (location === "atoms" ? data.atoms : data.frames[0].atoms)[0].element = alias;
    });
    outcomes.push(await decodeScienceSession(changed).then(() => "accepted", error => error.code));
  }
  expect(outcomes).toEqual(["science", "science", "science", "science"]);
});

test("MOLX keeps source XYZ aliases exact while scientific element symbols stay canonical", async () => {
  for (const alias of ["8", "o"]) {
    const source = XYZ.replace("O 0.000000", `${alias} 0.000000`);
    const decoded = (await decodeScienceSession(archive(await encodedScience(source))))!;
    expect(decoded.source.text).toBe(source);
    expect([decoded.science!.atoms[0].element, decoded.science!.frames[0].atoms[0].element]).toEqual(["O", "O"]);
  }
});
