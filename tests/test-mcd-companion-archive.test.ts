import { expect, test } from "bun:test";
import { gzipSync, zipSync, strToU8 } from "../apps/desktop/node_modules/fflate";
import { Window } from "happy-dom";
import { PluginContext } from "molstar/lib/mol-plugin/context.js";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec.js";
import type { UUID } from "molstar/lib/mol-util/uuid.js";
import { encodeScienceSession, decodeScienceSession, SCIENCE_MANIFEST_ASSET_ID, type EncodedScienceSession, type ScienceSessionContent } from "../apps/desktop/src/lib/science-session/codec";
import type { McdCompanionOriginal } from "../apps/desktop/src/lib/science-session/mcd-originals";
import { sha256Hex } from "../apps/desktop/src/lib/source-editing/source-identity";
import { spectralDocument } from "./scientific-spectra-document-fixture";
import { serializeXyz } from "../apps/desktop/src/lib/molecular-workbench/xyz";
import { readOrcaMcdBlocks } from "../apps/desktop/src/lib/molecular-workbench/orca-circular-spectra";
import { readXyzFrames } from "../apps/desktop/src/lib/science-session/source-frames";
import { validateScientificDocument } from "../apps/desktop/src/lib/science-session/scientific-document";
import { registerImportedScientificSource, claimImportedSource, scientificStateFor, releaseClosedImports } from "../apps/desktop/src/lib/workbench/scientific-source-state";
import { releaseClosedScienceSessions } from "../apps/desktop/src/lib/science-session/state";
import { restoreScienceSession } from "../apps/desktop/src/lib/science-session/restore";
import { writeBrowserDevVirtualTextDocument } from "../apps/desktop/src/lib/browser-dev-documents";
import { exportArchive, restore } from "./science-host-fixture";
import { realXyzViewer } from "./science-session-fixture";
import type { ViewerDocument } from "../apps/desktop/src/types";
const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e", binding = { structureRef: "s", modelRef: "m", trajectoryRef: "t", frameIndex: 0, frameCount: 2, atomCount: 3 };
async function fixture() {
  const { document: science, text: source } = spectralDocument(), text = source.replace("water restored", "water import-abc12345");
  const primary = Uint8Array.of(0x1f, 0x8b, 239, 187, 191, 13, 10, 0, 255);
  const stream = "\uFEFF10000 -2.25 .12\r\n10001 -0.125 .25\r\n", companion = gzipSync(strToU8(stream), { mtime: 0 });
  const hashes = { primaryOriginalSha256: await sha256Hex(primary), companionOriginalSha256: await sha256Hex(companion), sourceRevisionSha256: await sha256Hex(text) };
  const name = "selected.cis-el.dipole-length.1.mcd.gz", file = new Blob([companion as BlobPart], { type: "application/gzip" });
  science.frames[1].mcdCompanion = { ...hashes, spectra: { kind: "scientific-spectra", version: 1,
    source: { name, format: "orca-mcd", scope: "frame", frameIndex: 1, frameCount: 2 }, atomicNumbers: [8, 1, 1], spectra: [readOrcaMcdBlocks(stream)[0].spectrum] } };
  const raw: McdCompanionOriginal = { role: "orca-mcd", frameIndex: 1, frameCount: 2, name, file, ...hashes };
  const content: ScienceSessionContent = { documentUuid: uuid, source: { extension: "xyz", text }, atomIds: null, binding,
    science, original: { name: "authored.out.gz", file: new Blob([primary], { type: "application/gzip" }) }, companions: [raw] };
  return { content, primary, companion, raw };
}
function archive(encoded: EncodedScienceSession) {
  return zipSync({ "state.json": strToU8('{"entries":[]}'), "assets.json": strToU8(JSON.stringify(encoded.assets.map(asset => [asset.id, { id: asset.id, kind: "file", name: asset.name }]))),
    ...Object.fromEntries(encoded.assets.map(asset => [`assets/${asset.id}`, asset.bytes])) });
}
const manifestBytes = (encoded: EncodedScienceSession) => { encoded.assets.find(asset => asset.id === SCIENCE_MANIFEST_ASSET_ID)!.bytes = strToU8(JSON.stringify(encoded.manifest)); };
async function mutateData(encoded: EncodedScienceSession, edit: (value: NonNullable<ScienceSessionContent["science"]>) => void) {
  const asset = encoded.assets.find(asset => asset.id === encoded.manifest.science!.attachment)!, data = JSON.parse(new TextDecoder().decode(asset.bytes));
  edit(data); asset.bytes = strToU8(JSON.stringify(data));
  Object.assign(encoded.manifest.attachments.find(item => item.id === asset.id)!, { count: asset.bytes.length, byteLength: asset.bytes.length, sha256: await sha256Hex(asset.bytes) });
  manifestBytes(encoded);
}

test("actual MolStar MOLX save/open preserves paired compressed Originals and the independent scientific frame", async () => {
  const dom = new Window(), previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  const plugin = new PluginContext(DefaultPluginSpec()), reopened = new PluginContext(DefaultPluginSpec());
  try {
    await plugin.init(); await reopened.init();
    const { content, primary, companion } = await fixture();
    content.science!.atoms = content.science!.frames[1].atoms;
    content.source.text = serializeXyz(content.science!.atoms, "final geometry");
    const sourceRevisionSha256 = await sha256Hex(content.source.text);
    content.science!.frames[1].mcdCompanion = { ...content.science!.frames[1].mcdCompanion!, sourceRevisionSha256 };
    content.companions = [{ ...content.companions![0], sourceRevisionSha256 }];
    content.binding = { ...binding, frameCount: 1 };
    const raw = await plugin.builders.data.rawData({ data: content.source.text, label: "paired.xyz" });
    const trajectory = await plugin.builders.structure.parseTrajectory(raw, "xyz");
    await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
    const structure = plugin.managers.structure.hierarchy.current.structures[0];
    content.binding = { ...content.binding, structureRef: structure.cell.transform.ref, modelRef: structure.model!.cell.transform.ref, trajectoryRef: trajectory.ref };
    const encoded = await encodeScienceSession(content);
    expect(encoded.manifest.version).toBe(3);
    for (const asset of encoded.assets) plugin.managers.asset.set({ kind: "file", id: asset.id as UUID, name: asset.name }, new File([asset.bytes as BlobPart], asset.name));
    const bytes = new Uint8Array(await (await plugin.managers.snapshot.serialize({ type: "molx", params: { camera: false, image: false } })).arrayBuffer());
    await reopened.managers.snapshot.open(new File([bytes as BlobPart], "paired.molx"));
    expect(reopened.managers.structure.hierarchy.current.structures[0].cell.obj?.data.elementCount).toBe(3);
    const decoded = (await decodeScienceSession(bytes))!;
    expect(decoded.science).toEqual(content.science);
    expect([decoded.binding.frameIndex, decoded.binding.frameCount]).toEqual([0, 1]);
    expect(decoded.science!.frames[1].mcdCompanion!.spectra.source).toMatchObject({ frameIndex: 1, frameCount: 2 });
    expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(primary);
    expect(new Uint8Array(await decoded.companions![0].file.arrayBuffer())).toEqual(companion);
    expect(decoded.companions![0].file.type).toBe("application/gzip");
  } finally { plugin.dispose(); reopened.dispose(); if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); await dom.happyDOM.close(); }
});

test("checksum-valid wrong file/revision/frame and incomplete companion archives reject as a whole", async () => {
  for (const field of ["primaryOriginalSha256", "companionOriginalSha256", "sourceRevisionSha256"] as const) {
    const encoded = await encodeScienceSession((await fixture()).content);
    await mutateData(encoded, data => { data.frames[1].mcdCompanion = { ...data.frames[1].mcdCompanion!, [field]: "d".repeat(64) }; });
    await expect(decodeScienceSession(archive(encoded))).rejects.toMatchObject({ code: "science" });
  }
  for (const edit of [
    (value: EncodedScienceSession) => { value.manifest.companions![0].frameIndex = 0; },
    (value: EncodedScienceSession) => { value.manifest.companions![0].frameCount = 3; },
    (value: EncodedScienceSession) => { value.manifest.companions![0].name = "another.mcd"; },
    (value: EncodedScienceSession) => { value.manifest.original = null; },
  ]) {
    const encoded = await encodeScienceSession((await fixture()).content); edit(encoded); manifestBytes(encoded);
    await expect(decodeScienceSession(archive(encoded))).rejects.toMatchObject({ code: "science" });
  }
  const empty = await encodeScienceSession((await fixture()).content); empty.manifest.companions = []; manifestBytes(empty);
  await expect(decodeScienceSession(archive(empty))).rejects.toMatchObject({ code: "version" });
  const downgraded = await encodeScienceSession((await fixture()).content); downgraded.manifest.version = 1; manifestBytes(downgraded);
  await expect(decodeScienceSession(archive(downgraded))).rejects.toMatchObject({ code: "version" });
  const corrupted = await encodeScienceSession((await fixture()).content);
  corrupted.assets.find(asset => asset.id === corrupted.manifest.companions![0].attachment)!.bytes[0] ^= 1;
  await expect(decodeScienceSession(archive(corrupted))).rejects.toMatchObject({ code: "attachment" });
});

test("checksum-valid byte substitutions cannot reuse a pair merely because coordinates or atom counts agree", async () => {
  for (const target of ["source", "primary", "companion"] as const) {
    const { content } = await fixture(), encoded = await encodeScienceSession(content);
    const id = target === "source" ? encoded.manifest.source.attachment : target === "primary" ? encoded.manifest.original!.attachment : encoded.manifest.companions![0].attachment;
    const bytes = target === "source" ? strToU8(content.source.text.replace("import-abc12345", "import-def12345")) :
      gzipSync(strToU8(target === "primary" ? "another calculation, same atoms" : "10000 -2.25 .99\n10001 -.125 .25\n"), { mtime: 0 });
    encoded.assets.find(asset => asset.id === id)!.bytes = bytes;
    const sha256 = await sha256Hex(bytes);
    Object.assign(encoded.manifest.attachments.find(item => item.id === id)!, { count: bytes.length, byteLength: bytes.length, sha256 });
    if (target === "source") encoded.manifest.source.sha256 = sha256;
    manifestBytes(encoded);
    await expect(decodeScienceSession(archive(encoded))).rejects.toMatchObject({ code: "science" });
  }
});

test("raw provenance survives edits without advertising calculated data for the new geometry", async () => {
  const { content, companion, primary } = await fixture(), text = content.source.text.replace("O 0.000000", "O 0.500000");
  const encoded = await encodeScienceSession({ ...content, science: null, source: { extension: "xyz", text } });
  const decoded = (await decodeScienceSession(archive(encoded)))!;
  expect(decoded.science).toBeNull(); expect(decoded.source.text).toBe(text);
  expect(decoded.companions![0].sourceRevisionSha256).not.toBe(await sha256Hex(text));
  expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(primary);
  expect(new Uint8Array(await decoded.companions![0].file.arrayBuffer())).toEqual(companion);
});

test("cumulative spectrum and raw-byte budgets include companion sources before any oversized read", async () => {
  const { content } = await fixture();
  const data = content.science!; data.spectra = { ...data.spectra!, spectra: [{ kind: "dos", xUnit: "eV", positions: Array.from({ length: 9980 }, (_, i) => i), values: Array(9980).fill(1), valueUnit: null }] };
  expect(() => validateScientificDocument(data, readXyzFrames(content.source.text))).toThrow("budget");
  const clean = (await fixture()).content, large = new Blob(Array(21).fill(new Blob([new Uint8Array(1024 * 1024)])));
  let reads = 0; Object.defineProperty(large, "arrayBuffer", { value: () => { reads++; throw new Error("oversized-read"); } });
  await expect(encodeScienceSession({ ...clean, companions: [{ ...clean.companions![0], file: large }] })).rejects.toMatchObject({ code: "limit" });
  expect(reads).toBe(0);
});

test("host export/restore/re-export retains companion provenance and cancelled restore cannot replace it", async () => {
  const { content, companion, primary } = await fixture(), id = "paired-source", path = "burette-ketcher://paired-source/source.xyz";
  const document: ViewerDocument = { id, path, runtimePath: path, title: "source.xyz", extension: "xyz", renderer: "molstar", virtual: true, byteCount: content.source.text.length };
  writeBrowserDevVirtualTextDocument(path, content.source.text);
  registerImportedScientificSource("import-abc12345", content.source.text, content.science!, content.original, content.companions); claimImportedSource("import-abc12345", id);
  content.companions![0].name = "mutated-caller-label.mcd"; // Registry owns an immutable metadata copy.
  try {
    expect(scientificStateFor(id, content.source.text).companions![0].name).toBe("selected.cis-el.dipole-length.1.mcd.gz");
    const bytes = await exportArchive(document, content.source.text, await realXyzViewer(content.source.text));
    const { document: restored, outcome } = await restore(bytes, "/paired.molx", await realXyzViewer(content.source.text));
    expect(outcome).toBe("restored");
    const before = scientificStateFor(restored.id, content.source.text);
    expect(Object.isFrozen(before.companions)).toBe(true); expect(Object.isFrozen(before.companions![0])).toBe(true);
    const decoded = (await decodeScienceSession(await exportArchive(restored, content.source.text, await realXyzViewer(content.source.text))))!;
    expect(new Uint8Array(await decoded.companions![0].file.arrayBuffer())).toEqual(companion);
    expect(new Uint8Array(await decoded.original!.file.arrayBuffer())).toEqual(primary);
    let release!: (value: Uint8Array) => void, open = true;
    const held = new Promise<Uint8Array>(resolve => { release = resolve; });
    const pending = restoreScienceSession({ ...document, id: restored.id, path: "/late.molx", extension: "molx" }, { readBytes: () => held, isOpen: () => open,
      request: async () => { throw new Error("Cancelled restore must not request an ACK"); } });
    open = false; release(bytes); expect(await pending).toBe("cancelled");
    const after = scientificStateFor(restored.id, content.source.text);
    expect(after.original).toBe(before.original); expect(after.companions).toBe(before.companions);
  } finally { releaseClosedImports(new Set()); releaseClosedScienceSessions(new Set()); }
});
