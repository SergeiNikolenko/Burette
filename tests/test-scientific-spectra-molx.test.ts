import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { PluginContext } from "molstar/lib/mol-plugin/context.js";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec.js";
import type { UUID } from "molstar/lib/mol-util/uuid.js";
import { unzipSync, zipSync, strToU8 } from "../apps/desktop/node_modules/fflate";
import { encodeScienceSession, decodeScienceSession, SCIENCE_MANIFEST_ASSET_ID, type EncodedScienceSession } from "../apps/desktop/src/lib/science-session/codec";
import { sha256Hex } from "../apps/desktop/src/lib/source-editing/source-identity";
import { spectralDocument } from "./scientific-spectra-document-fixture";
const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e", original = Uint8Array.of(0x1f, 0x8b, 0xef, 0xbb, 0xbf, 13, 10, 0, 255);
const binding = { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 2, atomCount: 3 };
async function encode(sceneBinding = binding) {
  const { document, text } = spectralDocument();
  return encodeScienceSession({ documentUuid: uuid, source: { extension: "xyz", text }, atomIds: ["a", "b", "c"], binding: sceneBinding,
    science: document, original: { name: "authored-source.out.gz", file: new Blob([original], { type: "application/gzip" }) } });
}
function archive(encoded: EncodedScienceSession) {
  return zipSync({ "state.json": strToU8('{"entries":[]}'), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, kind: "file", name: asset.name }]))),
    ...Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes])) });
}
async function changed(bytes: Uint8Array, edit: (data: any) => void) {
  const files = unzipSync(bytes), manifest = JSON.parse(new TextDecoder().decode(files[`assets/${SCIENCE_MANIFEST_ASSET_ID}`]));
  const id = manifest.science.attachment, data = JSON.parse(new TextDecoder().decode(files[`assets/${id}`])); edit(data);
  const json = strToU8(JSON.stringify(data)), descriptor = manifest.attachments.find((item: { id: string }) => item.id === id);
  Object.assign(descriptor, { sha256: await sha256Hex(json), byteLength: json.length, count: json.length });
  files[`assets/${id}`] = json; files[`assets/${SCIENCE_MANIFEST_ASSET_ID}`] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

test("a real MolStar snapshot serialize/open and host MOLX decode preserve all six kinds, both frames and exact Original bytes", async () => {
  const dom = new Window(), previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  const plugin = new PluginContext(DefaultPluginSpec()), reopened = new PluginContext(DefaultPluginSpec());
  try {
    await plugin.init(); await reopened.init();
    const { document, text } = spectralDocument();
    const raw = await plugin.builders.data.rawData({ data: text, label: "spectral-source.xyz" });
    const trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
    const structure = plugin.managers.structure.hierarchy.current.structures[0];
    if (!structure.model) throw new Error("Actual source model is missing");
    const sceneBinding = { ...binding, structureRef: structure.cell.transform.ref, modelRef: structure.model.cell.transform.ref, trajectoryRef: trajectory.ref };
    expect(trajectory.obj?.data.frameCount).toBe(2);
    const encoded = await encode(sceneBinding);
    for (const asset of encoded.assets) plugin.managers.asset.set({ kind: "file", id: asset.id as UUID, name: asset.name }, new File([asset.bytes as BlobPart], asset.name));
    const blob = await plugin.managers.snapshot.serialize({ type: "molx", params: { camera: false, image: false } });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const state = JSON.parse(new TextDecoder().decode(unzipSync(bytes)["state.json"]));
    expect(state.entries[0].snapshot.data.tree.transforms.some((transform: { transformer: string }) => transform.transformer.endsWith("trajectory-from-xyz"))).toBe(true);
    await reopened.managers.snapshot.open(new File([bytes as BlobPart], "spectra.molx"));
    expect(reopened.managers.structure.hierarchy.current.structures[0].cell.obj?.data.elementCount).toBe(3);
    const decoded = (await decodeScienceSession(bytes))!;
    expect(decoded.science).toEqual(document);
    expect(decoded.binding).toEqual(sceneBinding);
    expect(decoded.source).toEqual({ extension: "xyz", text });
    expect(decoded.science!.frames[1].spectra!.source).toHaveProperty("frameIndex", 1);
    expect(decoded.science!.spectra!.source.scope).toBe("file");
    expect(decoded.atomIds).toEqual(["a", "b", "c"]);
    expect(decoded.original!.file.type).toBe("application/gzip");
    expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(original);
  } finally {
    plugin.dispose(); reopened.dispose();
    if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document");
    await dom.happyDOM.close();
  }
});

test("checksum-valid MOLX cannot substitute another frame, atom order, quantity or malformed spectral rows", async () => {
  const bytes = archive(await encode());
  const edits: Array<(data: any) => void> = [
    data => { data.frames[1].spectra.source.frameIndex = 0; },
    data => { data.frames[1].spectra.source.frameCount = 1; },
    data => { data.frames[1].spectra.source = { name: "wrong", format: "avogadro-matrix", scope: "file" }; },
    data => { data.spectra.source = { name: "wrong", format: "avogadro-matrix", scope: "frame", frameIndex: 0, frameCount: 2 }; },
    data => { data.frames[1].spectra.atomicNumbers = [1, 8, 1]; },
    data => { data.frames[1].spectra.spectra[2].atomIndices = [0, 0]; },
    data => { data.frames[1].spectra.spectra[2].quantity = "already-referenced-chemical-shift"; },
    data => { data.frames[1].spectra.spectra[3].sourceRowIds = ["x", "x"]; },
    data => { data.frames[1].spectra.spectra[4].values = [1]; },
  ];
  for (const edit of edits) await expect(decodeScienceSession(await changed(bytes, edit))).rejects.toMatchObject({ code: "science" });
  expect((await decodeScienceSession(bytes))!.science).toEqual(spectralDocument().document);
});

test("a final-layout scene retains original scientific frame indices instead of rebinding them to viewer frame zero", async () => {
  const { document } = spectralDocument(); document.atoms = document.frames[1].atoms;
  const text = `3\nfinal geometry\n${document.atoms.map(atom => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`).join("\n")}\n`;
  const encoded = await encodeScienceSession({ documentUuid: uuid, source: { extension: "xyz", text }, atomIds: null,
    binding: { ...binding, frameCount: 1 }, science: document, original: null });
  const decoded = (await decodeScienceSession(archive(encoded)))!;
  expect([decoded.binding.frameIndex, decoded.binding.frameCount]).toEqual([0, 1]);
  expect(decoded.science!.frames[1].spectra!.source).toMatchObject({ scope: "frame", frameIndex: 1, frameCount: 2 });
  expect(decoded.science).toEqual(document);
});
