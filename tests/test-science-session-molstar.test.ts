import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";
import { PluginContext } from "molstar/lib/mol-plugin/context.js";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec.js";
import type { Asset } from "molstar/lib/mol-util/assets.js";
import type { UUID } from "molstar/lib/mol-util/uuid.js";
import { unzipSync } from "../apps/desktop/node_modules/fflate/esm/browser.js";

const dom = new Window(), previous = Object.getOwnPropertyDescriptor(globalThis, "document");
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
afterAll(async () => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); await dom.happyDOM.close(); });
const window: Record<string, any> = {};
let nextDigest: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
const runtimeCrypto = { subtle: { async digest(algorithm: AlgorithmIdentifier, bytes: BufferSource) {
  const held = nextDigest; nextDigest = null;
  const result = await crypto.subtle.digest(algorithm, bytes);
  if (held) { held.entered.resolve(); await held.release.promise; }
  return result;
} } };
vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/scene-file-actions.js", import.meta.url), "utf8"), { window, crypto: runtimeCrypto, TextEncoder, File, Uint8Array, Float64Array });
const science = window.BuretteSceneFiles.science;
const source = ["Runtime graph", "Burette", "", "  2  1  0  0  0  0            999 V2000",
  "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
  "    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
  "  1  2  2  0  0  0  0", "M  CHG  2   1   1   2  -1", "M  END", "$$$$", ""].join("\n");
const xyz = "2\nfirst\nC 0 0 0\nO 1.2 0 0\n2\nsecond\nC .2 0 0\nO 1.4 0 0\n";
const utf8 = (text: string) => new TextEncoder().encode(text);
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), byte => byte.toString(16).padStart(2, "0")).join("");
const bindingOf = (report: any) => Object.fromEntries(["structureRef", "modelRef", "trajectoryRef", "frameIndex", "frameCount", "atomCount"].map(key => [key, report[key]]));
const fileAsset = (id: string, name: string): Asset.File => ({ kind: "file", id: id as UUID, name });
const options = { type: "molx" as const, params: { camera: false, image: false } };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(format: "sdf" | "xyz" = "sdf") {
  const plugin = new PluginContext(DefaultPluginSpec()); await plugin.init();
  const text = format === "sdf" ? source : xyz;
  const raw = await plugin.builders.data.rawData({ data: text, label: `source.${format}` });
  const trajectory = await plugin.builders.structure.parseTrajectory(raw, format);
  await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", { representationPreset: "empty" });
  const viewer = { plugin }, report = format === "sdf" ? await science.sdfBinding(viewer) : science.binding(viewer);
  const sourceBytes = utf8(text), originalBytes = Uint8Array.of(0, 255, 13, 10, 7);
  const descriptors = await Promise.all([sourceBytes, originalBytes].map(async (bytes, i) => ({
    id: `burette-science-attachment-${i}`, dtype: i ? "bytes" : "utf8", count: bytes.length, byteLength: bytes.length, sha256: await hash(bytes),
  })));
  // Literal v1 manifest exercises the opaque runtime asset boundary, without importing host codec/science modules.
  const manifest = { kind: "burette.science-session", version: 1, document: { uuid: "0f8fad5b-d9cb-469f-a165-70867728950e" },
    source: { extension: format, attachment: descriptors[0].id, sha256: descriptors[0].sha256 }, atoms: { count: 2, ids: null },
    binding: bindingOf(report), science: null, original: { name: "original.bin", type: "application/octet-stream", attachment: descriptors[1].id }, attachments: descriptors };
  const assets = [{ id: "burette-science-manifest", name: "burette-science.json", bytes: utf8(JSON.stringify(manifest)) },
    { id: descriptors[0].id, name: `source.${format}`, bytes: sourceBytes }, { id: descriptors[1].id, name: "original.bin", bytes: originalBytes }];
  const request = { binding: bindingOf(report), positions: report.positions.slice(), ...(format === "sdf" ? { sourceSha256: report.sourceSha256 } : {}), assets };
  const provenance = fileAsset("ordinary-provenance", "original-scene-file.bin");
  plugin.managers.asset.set(provenance, new File([Uint8Array.of(9, 8, 255, 0)], provenance.name), { tag: "scene-provenance", isStatic: true });
  return { plugin, viewer, raw, report, request, assets, manifest, provenance, close: () => plugin.dispose() };
}
function holdSnapshot(plugin: PluginContext) {
  const original = plugin.managers.snapshot.serialize.bind(plugin.managers.snapshot), entered = deferred(), release = deferred();
  plugin.managers.snapshot.serialize = (async params => { const archive = await original(params); entered.resolve(); await release.promise; return archive; }) as typeof plugin.managers.snapshot.serialize;
  return { entered: entered.promise, release: release.resolve };
}

test("real snapshot ZIP embeds exact manifest/source/original bytes and retains ordinary scene assets", async () => {
  const f = await fixture();
  try {
    const before = f.plugin.managers.asset.get(f.provenance)!;
    expect(science.present(f.plugin)).toBe(false);
    const archive: Blob = await science.serialize(f.viewer, f.request, options);
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const index = JSON.parse(new TextDecoder().decode(files["assets.json"]));
    expect(index.map(([id]: [string]) => id).sort()).toEqual([f.provenance.id, ...f.assets.map(asset => asset.id)].sort());
    for (const asset of f.assets) expect(files[`assets/${asset.id}`]).toEqual(asset.bytes);
    const manifest = JSON.parse(new TextDecoder().decode(files["assets/burette-science-manifest"]));
    expect([manifest.source.attachment, manifest.original.attachment, manifest.attachments.map((a: any) => a.sha256)]).toEqual([
      f.assets[1].id, f.assets[2].id, await Promise.all(f.assets.slice(1).map(asset => hash(files[`assets/${asset.id}`]))),
    ]);
    expect(files[`assets/${f.provenance.id}`]).toEqual(Uint8Array.of(9, 8, 255, 0));
    const snapshot = JSON.parse(new TextDecoder().decode(files["state.json"]));
    expect(snapshot.entries[0].snapshot.data.tree.transforms.some((t: any) => t.transformer.endsWith("trajectory-from-sdf"))).toBe(true);
    expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
    expect(f.plugin.managers.asset.get(f.provenance)).toBe(before);
    expect(science.present(f.plugin)).toBe(true);
  } finally { f.close(); }
});

test("failed serialization removes only its temporary assets and releases the export lock", async () => {
  const f = await fixture();
  try {
    const before = f.plugin.managers.asset.get(f.provenance)!;
    const original = f.plugin.managers.snapshot.serialize.bind(f.plugin.managers.snapshot);
    f.plugin.managers.snapshot.serialize = async () => { expect(f.plugin.managers.asset.assets.length).toBe(4); throw new Error("actual serialization interrupted"); };
    await expect(science.serialize(f.viewer, f.request, options)).rejects.toThrow("interrupted");
    expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
    expect(f.plugin.managers.asset.get(f.provenance)).toBe(before);
    expect(science.present(f.plugin)).toBe(false);
    f.plugin.managers.snapshot.serialize = original;
    await science.serialize(f.viewer, f.request, options);
    expect(f.plugin.managers.asset.get(f.provenance)).toBe(before);
  } finally { f.close(); }
});

test("reserved-id admission refuses before overwriting any original asset or reference count", async () => {
  for (const id of ["burette-science-unrelated", "burette-science-attachment-0"]) {
    const f = await fixture();
    try {
      const asset = fileAsset(id, "original.bin");
      const file = new File(["live source"], asset.name);
      f.plugin.managers.asset.set(asset, file, { tag: "original-owner" });
      const first = await f.plugin.managers.asset.resolve(asset, "binary").run(), second = await f.plugin.managers.asset.resolve(asset, "binary").run();
      const before = f.plugin.managers.asset.get(asset)!;
      await expect(science.serialize(f.viewer, f.request, options)).rejects.toThrow("holds scientific attachments");
      expect(f.plugin.managers.asset.get(asset)).toBe(before);
      expect([before.file, before.asset, before.tag, before.refCount]).toEqual([file, asset, "original-owner", 2]);
      first.dispose(); expect(f.plugin.managers.asset.get(asset)?.refCount).toBe(1);
      expect(new TextDecoder().decode(second.data)).toBe("live source");
      second.dispose(); expect(f.plugin.managers.asset.has(asset)).toBe(false);
    } finally { f.close(); }
  }
});

test("raw SDF and actual trajectory frame changes after snapshot capture reject and clean up", async () => {
  for (const format of ["sdf", "xyz"] as const) {
    const f = await fixture(format), held = holdSnapshot(f.plugin);
    try {
      const running = science.serialize(f.viewer, f.request, options); await held.entered;
      if (format === "sdf") await f.plugin.state.data.build().to(f.raw).update({ data: source + "\n" }).commit();
      else await f.plugin.state.data.build().to(f.report.modelRef).update({ modelIndex: 1 }).commit();
      held.release(); await expect(running).rejects.toThrow("changed while it was being saved");
      expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
      expect(science.present(f.plugin)).toBe(false);
    } finally { held.release(); f.close(); }
  }
});

test("science exports refuse overlap and exclusive work waits for cleanup, including failed callbacks", async () => {
  const f = await fixture(), held = holdSnapshot(f.plugin);
  try {
    const running = science.serialize(f.viewer, f.request, options); await held.entered;
    await expect(science.serialize(f.viewer, f.request, options)).rejects.toThrow("already being saved");
    let entered = false;
    const exclusive = science.exclusive(f.plugin, async () => { entered = true; expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]); return "exclusive result"; });
    await Promise.resolve(); expect(entered).toBe(false);
    held.release(); await running; expect(await exclusive).toBe("exclusive result");
    await expect(science.exclusive(f.plugin, async () => { throw new Error("exclusive failed"); })).rejects.toThrow("exclusive failed");
    expect(await science.exclusive(f.plugin, async () => "next run")).toBe("next run");
  } finally { held.release(); f.close(); }
});

test("a style-only change retains the consistent captured style and the independently updated live style", async () => {
  const f = await fixture();
  try {
    const structure = f.plugin.managers.structure.hierarchy.current.structures[0].cell;
    const component = await f.plugin.builders.structure.tryCreateComponentStatic(structure, "all");
    const representation = await f.plugin.builders.structure.representation.addRepresentation(component!, { type: "ball-and-stick", color: "uniform", colorParams: { value: 0x112233 } });
    const held = holdSnapshot(f.plugin);
    const running = science.serialize(f.viewer, f.request, options); await held.entered;
    await f.plugin.state.data.build().to(representation).update(params => ({ ...params, colorTheme: { name: "uniform", params: { value: 0x445566 } } })).commit();
    held.release(); const archive: Blob = await running;
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer())), snapshot = JSON.parse(new TextDecoder().decode(files["state.json"]));
    const captured = snapshot.entries[0].snapshot.data.tree.transforms.find((transform: any) => transform.ref === representation.ref);
    expect([captured.params.colorTheme.params.value, f.plugin.state.data.cells.get(representation.ref)!.transform.params.colorTheme.params.value]).toEqual([0x112233, 0x445566]);
    expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
  } finally { f.close(); }
});

test("reserved assets arriving during the initial digest retain their original live wrappers on refusal", async () => {
  for (const id of ["burette-science-attachment-0", "burette-science-unrelated"]) {
    const f = await fixture(), held = { entered: deferred(), release: deferred() };
    try {
      nextDigest = held;
      const running = science.serialize(f.viewer, f.request, options); await held.entered.promise;
      const asset = fileAsset(id, "raced-import.bin");
      f.plugin.managers.asset.set(asset, new File(["raced original"], asset.name), { tag: "import-owner", isStatic: true });
      const first = await f.plugin.managers.asset.resolve(asset, "binary").run(), second = await f.plugin.managers.asset.resolve(asset, "binary").run();
      const before = f.plugin.managers.asset.get(asset)!;
      first.dispose(); held.release.resolve();
      await expect(running).rejects.toThrow("holds scientific attachments");
      expect(f.plugin.managers.asset.get(asset)).toBe(before);
      expect([before.refCount, before.tag, before.isStatic, new TextDecoder().decode(second.data)]).toEqual([1, "import-owner", true, "raced original"]);
      second.dispose(); expect(before.refCount).toBe(0);
      expect(f.plugin.managers.asset.has(asset)).toBe(true);
      expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id)).sort()).toEqual([f.provenance.id, id].sort());
    } finally { nextDigest = null; held.release.resolve(); f.close(); }
  }
});

test("cleanup never deletes a foreign replacement of a temporary science asset", async () => {
  const f = await fixture(), held = holdSnapshot(f.plugin);
  try {
    const running = science.serialize(f.viewer, f.request, options); await held.entered;
    const asset = fileAsset(f.assets[1].id, "replacement.bin");
    const file = new File(["foreign replacement"], asset.name);
    f.plugin.managers.asset.set(asset, file, { tag: "new-owner", isStatic: true });
    const before = f.plugin.managers.asset.get(asset)!;
    held.release(); await expect(running).rejects.toThrow("attachments changed while it was being saved");
    expect(f.plugin.managers.asset.get(asset)).toBe(before);
    expect([before.file, before.tag, before.isStatic]).toEqual([file, "new-owner", true]);
    expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id)).sort()).toEqual([f.provenance.id, asset.id].sort());
  } finally { held.release(); f.close(); }
});

test("real MOLX reopen adopts only imported science assets and preserves ordinary provenance", async () => {
  const f = await fixture(), opened = new PluginContext(DefaultPluginSpec());
  try {
    const archive = await science.serialize(f.viewer, f.request, options); await opened.init();
    await opened.managers.snapshot.open(new File([archive], "roundtrip.molx"));
    expect(opened.managers.structure.hierarchy.current.structures.length).toBe(1);
    expect(opened.managers.asset.assets.filter(entry => entry.asset.id.startsWith(science.prefix)).length).toBe(3);
    expect((await science.sdfBinding({ plugin: opened })).sourceSha256).toBe(f.report.sourceSha256);
    await expect(science.exclusive(opened, async () => "must not run")).rejects.toThrow("holds scientific attachments");
    expect(science.adoptImported(opened)).toBe(true);
    expect([science.present(opened), science.adoptImported(opened)]).toEqual([true, false]);
    expect(opened.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
    const file = opened.managers.asset.get(f.provenance)!.file;
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(Uint8Array.of(9, 8, 255, 0));
    expect(await science.exclusive(opened, () => opened.managers.snapshot.serialize(options))).toBeInstanceOf(Blob);
    const resaved: Blob = await science.serialize({ plugin: opened }, f.request, options);
    const files = unzipSync(new Uint8Array(await resaved.arrayBuffer()));
    for (const asset of f.assets) expect(files[`assets/${asset.id}`]).toEqual(asset.bytes);
    expect(files[`assets/${f.provenance.id}`]).toEqual(Uint8Array.of(9, 8, 255, 0));
    expect(opened.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
  } finally { opened.dispose(); f.close(); }
});

test("invalid asset requests reject before changing the real asset inventory", async () => {
  const f = await fixture();
  try {
    for (const assets of [[], Array(66).fill(f.assets[0]), [f.assets[0], f.assets[0]], [{ ...f.assets[0], id: "foreign-id" }], [{ ...f.assets[0], bytes: [1, 2] }]]) {
      await expect(science.serialize(f.viewer, { ...f.request, assets }, options)).rejects.toThrow("invalid scientific data");
      expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
    }
    expect(science.present(f.plugin)).toBe(false);
  } finally { f.close(); }
});
