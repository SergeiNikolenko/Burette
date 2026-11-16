import { expect, test } from "bun:test";
import { zipSync, strToU8 } from "../apps/desktop/node_modules/fflate";
import { readFileSync } from "node:fs";
import { encodeScienceSession, decodeScienceSession, SCIENCE_MANIFEST_ASSET_ID, type EncodedScienceSession } from "../apps/desktop/src/lib/science-session/codec";
import { sceneSourceFrames, shownSceneSource } from "../apps/desktop/src/lib/science-session/source-frames";
import { crystalPreviewData } from "../apps/desktop/src/lib/crystal-preview";

const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/crystals/${name}`, import.meta.url), "utf8");
function archive(encoded: EncodedScienceSession) {
  return zipSync({ "state.json": strToU8('{"entries":[]}'), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, kind: "file", name: asset.name }]))),
    ...Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes])) });
}
async function encoded(extension: "cif" | "vasp", text: string) {
  const frames = await sceneSourceFrames(text, extension);
  return encodeScienceSession({ documentUuid: uuid, source: { extension, text }, atomIds: null, science: null, original: null,
    binding: { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: frames[0].elements.length } });
}
function withManifest(session: EncodedScienceSession, edit: (manifest: Record<string, any>) => void) {
  const manifest = structuredClone(session.manifest) as Record<string, any>; edit(manifest);
  return archive({ ...session, assets: session.assets.map(asset => asset.id === SCIENCE_MANIFEST_ASSET_ID ? { ...asset, bytes: strToU8(JSON.stringify(manifest)) } : asset) });
}

test("a CIF or POSCAR crystal is compared as the full cell the viewer receives", async () => {
  for (const [extension, name] of [["cif", "rutile.cif"], ["vasp", "si.poscar"]] as const) {
    const text = fixture(name), preview = await crystalPreviewData(text, extension);
    expect(await shownSceneSource(text, extension), name).toEqual({ text: new TextDecoder().decode(preview!.bytes), extension: "xyz" });
  }
  await expect(shownSceneSource(fixture("triclinic-molecule.xyz"), "cif")).rejects.toThrow("not a crystal");
});

test("a crystal scene source survives the codec as version 5 and older versions cannot claim one", async () => {
  for (const [extension, name] of [["cif", "rutile.cif"], ["vasp", "si.poscar"]] as const) {
    const text = fixture(name), session = await encoded(extension, text);
    expect([session.manifest.version, session.manifest.source.extension], name).toEqual([5, extension]);
    const decoded = (await decodeScienceSession(archive(session)))!;
    expect([decoded.source, decoded.science, decoded.original]).toEqual([{ extension, text }, null, null]);
    await expect(decodeScienceSession(withManifest(session, manifest => { manifest.version = 4; }))).rejects.toMatchObject({ code: "version" });
    await expect(decodeScienceSession(withManifest(session, manifest => { manifest.binding.atomCount = manifest.atoms.count = 1; }))).rejects.toMatchObject({ code: "binding" });
  }
  const xyz = "1\nwater\nO 0 0 0\n";
  const plain = await encodeScienceSession({ documentUuid: uuid, source: { extension: "xyz", text: xyz }, atomIds: null, science: null, original: null,
    binding: { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: 1 } });
  await expect(decodeScienceSession(withManifest(plain, manifest => { manifest.version = 5; }))).rejects.toMatchObject({ code: "version" });
});
