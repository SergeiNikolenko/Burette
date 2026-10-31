import { expect, test } from "bun:test";
import { plugin as installPlugin } from "bun";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { unzipSync, zipSync, strToU8 } from "../apps/desktop/node_modules/fflate";
import type { UUID } from "molstar/lib/mol-util/uuid.js";
import { molstarMolV3000Plugin } from "../scripts/molstar-mol-v3000.mjs";
import { molstarV3000ChargesPlugin } from "../scripts/molstar-v3000-charges.mjs";
import { readCjsonGraph } from "../apps/desktop/src/lib/molecular-workbench/cjson-graph";
import type { ScientificDocument } from "../apps/desktop/src/lib/molecular-workbench/scientific-types";
import { encodeScienceSession, decodeScienceSession, SCIENCE_MANIFEST_ASSET_ID, type EncodedScienceSession, type ScienceSessionContent } from "../apps/desktop/src/lib/science-session/codec";
import { sha256Hex } from "../apps/desktop/src/lib/source-editing/source-identity";
installPlugin(molstarMolV3000Plugin); installPlugin(molstarV3000ChargesPlugin);
const { PluginContext } = await import("molstar/lib/mol-plugin/context.js");
const { DefaultPluginSpec } = await import("molstar/lib/mol-plugin/spec.js");
const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
const binding = { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 1, atomCount: 4 };
function content(name = "nmr.cjson"): ScienceSessionContent {
  const path = name === "nmr.cjson" ? "./fixtures/quantum/spectra-native-nmr.cjson" : `./fixtures/cjson/${name}`;
  const input = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  if (name === "nmr.cjson") {
    const first = input.atoms.coords["3d"];
    input.atoms.coords["3dSets"] = [first, first.map((v: number, i: number) => v + (i % 3 === 0 ? 2 : 0))];
    input.atoms.coords["3dSetsActive"] = 1;
  }
  const bytes = new TextEncoder().encode("\uFEFF" + JSON.stringify(input, null, 2).replaceAll("\n", "\r\n"));
  const parsed = readCjsonGraph(name, new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes));
  const science: ScientificDocument = { format: "cjson", atoms: parsed.structure.atoms,
    frames: parsed.coordinateSets.map(atoms => ({ atoms })), modes: [], orbitals: [],
    graph: { molfile: parsed.structure.molfile, activeFrameIndex: parsed.activeSet }, ...(parsed.spectra ? { spectra: parsed.spectra } : {}) };
  return { documentUuid: uuid, source: { extension: "mol", text: parsed.structure.molfile }, atomIds: parsed.structure.atoms.map((_, i) => `atom-${i}`),
    binding: { ...binding, atomCount: parsed.structure.atoms.length }, science, original: { name, file: new Blob([bytes], { type: "chemical/x-cjson" }) } };
}
function archive(encoded: EncodedScienceSession) {
  return zipSync({ "state.json": strToU8('{"entries":[]}'), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, kind: "file", name: asset.name }]))),
    ...Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes])) });
}
async function changeAttachment(encoded: EncodedScienceSession, id: string, text: string) {
  const asset = encoded.assets.find(asset => asset.id === id)!; asset.bytes = strToU8(text);
  const hash = await sha256Hex(asset.bytes);
  Object.assign(encoded.manifest.attachments.find(item => item.id === id)!, { sha256: hash, byteLength: asset.bytes.length, count: asset.bytes.length });
  if (id === encoded.manifest.source.attachment) encoded.manifest.source.sha256 = hash;
  encoded.assets.find(asset => asset.id === SCIENCE_MANIFEST_ASSET_ID)!.bytes = strToU8(JSON.stringify(encoded.manifest));
}

test("real MolStar MOL snapshot/reopen retains source graph, CJSON active set, all sets, NMR and exact Original", async () => {
  const dom = new Window(), previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  const native = new PluginContext(DefaultPluginSpec()), reopened = new PluginContext(DefaultPluginSpec());
  try {
    await native.init(); await reopened.init();
    const original = content(), text = original.source.text;
    const raw = await native.builders.data.rawData({ data: text, label: "nmr.mol" });
    const trajectory = await native.builders.structure.parseTrajectory(raw, "mol");
    await native.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
    const structure = native.managers.structure.hierarchy.current.structures[0];
    if (!structure.model) throw new Error("No native MOL model");
    original.binding = { ...original.binding, structureRef: structure.cell.transform.ref, modelRef: structure.model.cell.transform.ref, trajectoryRef: trajectory.ref };
    const encoded = await encodeScienceSession(original); expect(encoded.manifest.version).toBe(4);
    for (const asset of encoded.assets) native.managers.asset.set({ kind: "file", id: asset.id as UUID, name: asset.name }, new File([asset.bytes as BlobPart], asset.name));
    const blob = await native.managers.snapshot.serialize({ type: "molx", params: { camera: false, image: false } });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const state = JSON.parse(new TextDecoder().decode(unzipSync(bytes)["state.json"]));
    expect(state.entries[0].snapshot.data.tree.transforms.some((t: { transformer: string }) => t.transformer.endsWith("trajectory-from-mol"))).toBe(true);
    await reopened.managers.snapshot.open(new File([bytes as BlobPart], "cjson.molx"));
    expect(reopened.managers.structure.hierarchy.current.structures[0].cell.obj!.data.elementCount).toBe(4);
    expect(reopened.state.data.cells.get(raw.ref)?.obj?.data).toBe(text);
    let decoded = (await decodeScienceSession(bytes))!;
    for (let i = 0; i < 2; i++) {
      expect(decoded.science).toEqual(original.science); expect(decoded.source).toEqual(original.source);
      expect(decoded.atomIds).toEqual(original.atomIds); expect(decoded.binding).toEqual(original.binding);
      expect([decoded.binding.frameIndex, decoded.binding.frameCount, decoded.science!.graph!.activeFrameIndex, decoded.science!.frames.length]).toEqual([0, 1, 1, 2]);
      expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(new Uint8Array(await original.original!.file.arrayBuffer()));
      decoded = (await decodeScienceSession(archive(await encodeScienceSession(decoded))))!;
    }
  } finally {
    native.dispose(); reopened.dispose();
    if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document");
    await dom.happyDOM.close();
  }
});

test("producer L/D source-order stereo graph bytes and scientific identity survive repeated codec roundtrips", async () => {
  for (const name of ["L-alanine.cjson", "D-alanine.cjson"]) {
    const original = content(name); let current = original;
    for (let i = 0; i < 2; i++) {
      const encoded = await encodeScienceSession(current); expect(encoded.manifest.version).toBe(4);
      current = (await decodeScienceSession(archive(encoded)))!;
      expect(current.source).toEqual(original.source); expect(current.science).toEqual(original.science);
      expect(new Uint8Array(await current.original!.file.arrayBuffer())).toEqual(new Uint8Array(await original.original!.file.arrayBuffer()));
    }
  }
});

test("checksum-valid graph/science substitution, wrong active set and legacy version claims are refused", async () => {
  const edits: Array<(science: any) => void> = [
    science => { science.graph.molfile = science.graph.molfile.replace(/M  V30 1 2 /, "M  V30 1 1 "); },
    science => { science.graph.activeFrameIndex = 0; }, science => { science.graph.activeFrameIndex = 2; },
    science => { delete science.graph; }, science => { science.format = "xyz"; },
    science => { science.format = "xyz"; delete science.graph; },
  ];
  for (const edit of edits) {
    const encoded = await encodeScienceSession(content()), id = encoded.manifest.science!.attachment;
    const value = JSON.parse(new TextDecoder().decode(encoded.assets.find(asset => asset.id === id)!.bytes)); edit(value);
    await changeAttachment(encoded, id, JSON.stringify(value));
    await expect(decodeScienceSession(archive(encoded))).rejects.toMatchObject({ code: "science" });
  }
  const encoded = await encodeScienceSession(content());
  await changeAttachment(encoded, encoded.manifest.source.attachment, content().source.text.replace(/M  V30 1 2 /, "M  V30 1 1 "));
  await expect(decodeScienceSession(archive(encoded))).rejects.toMatchObject({ code: "science" });
  for (const version of [1, 2, 3] as const) {
    const encoded = await encodeScienceSession(content()); encoded.manifest.version = version;
    encoded.assets.find(asset => asset.id === SCIENCE_MANIFEST_ASSET_ID)!.bytes = strToU8(JSON.stringify(encoded.manifest));
    await expect(decodeScienceSession(archive(encoded))).rejects.toBeInstanceOf(Error);
  }
  const missing = content(); missing.original = null;
  await expect(encodeScienceSession(missing)).rejects.toMatchObject({ code: "science" });
  const plain = content(); plain.science = null;
  expect((await encodeScienceSession(plain)).manifest.version).toBe(2);
});
