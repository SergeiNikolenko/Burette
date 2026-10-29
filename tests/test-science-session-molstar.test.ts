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
const runtimeCrypto = { randomUUID: crypto.randomUUID.bind(crypto), subtle: { async digest(algorithm: AlgorithmIdentifier, bytes: BufferSource) {
  const held = nextDigest; nextDigest = null;
  const result = await crypto.subtle.digest(algorithm, bytes);
  if (held) { held.entered.resolve(); await held.release.promise; }
  return result;
} } };
vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/scene-file-actions.js", import.meta.url), "utf8"), { window, crypto: runtimeCrypto, TextEncoder, TextDecoder, File, Uint8Array, Float64Array });
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

test("real MOLX reopen retains science until validated ownership and preserves ordinary provenance", async () => {
  const f = await fixture(), opened = new PluginContext(DefaultPluginSpec());
  try {
    const archive = await science.serialize(f.viewer, f.request, options); await opened.init();
    const token = science.beginImport(opened);
    await opened.managers.snapshot.open(new File([archive], "roundtrip.molx"));
    expect(science.completeImport(opened, token)).toBe(true);
    expect(opened.managers.structure.hierarchy.current.structures.length).toBe(1);
    expect(opened.managers.asset.assets.filter(entry => entry.asset.id.startsWith(science.prefix)).length).toBe(3);
    expect((await science.sdfBinding({ plugin: opened })).sourceSha256).toBe(f.report.sourceSha256);
    await expect(science.exclusive(opened, async () => "must not run")).rejects.toThrow("holds scientific attachments");
    const receipt = { ...f.request, importToken: token, manifestSha256: await hash(f.assets[0].bytes) };
    const unclaimed = unzipSync(new Uint8Array(await (await opened.managers.snapshot.serialize(options)).arrayBuffer()));
    for (const asset of f.assets) expect(unclaimed[`assets/${asset.id}`]).toEqual(asset.bytes);
    expect(await science.adoptValidated({ plugin: opened }, receipt)).toBe(true);
    expect([science.present(opened), await science.adoptValidated({ plugin: opened }, receipt)]).toEqual([true, true]);
    expect(science.adoptImported).toBeUndefined();
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


async function importedFixture(format: "sdf" | "xyz" = "sdf") {
  const f = await fixture(format), plugin = new PluginContext(DefaultPluginSpec());
  const archive = await science.serialize(f.viewer, f.request, options); await plugin.init();
  const token = science.beginImport(plugin);
  await plugin.managers.snapshot.open(new File([archive], "incoming.molx"));
  science.completeImport(plugin, token);
  return { ...f, imported: plugin, importedViewer: { plugin }, archive,
    receipt: { ...f.request, importToken: token, manifestSha256: await hash(f.assets[0].bytes) },
    close() { plugin.dispose(); f.close(); } };
}
const sameEntries = (plugin: PluginContext, entries: typeof plugin.managers.asset.assets) =>
  entries.length === plugin.managers.asset.assets.length && entries.every(entry => plugin.managers.asset.get(entry.asset) === entry);

test("invalid receipt or current source/frame never adopts imported assets", async () => {
  for (const kind of ["receipt", "source", "frame", "missing-graph-sha"] as const) {
    const f = await importedFixture(kind === "frame" ? "xyz" : "sdf");
    try {
      const entries = f.imported.managers.asset.assets;
      if (kind === "source") await f.imported.state.data.build().to(f.raw.ref).update({ data: source + "\n" }).commit();
      if (kind === "frame") await f.imported.state.data.build().to(f.report.modelRef).update({ modelIndex: 1 }).commit();
      const receipt = kind === "receipt" ? { ...f.receipt, manifestSha256: "0".repeat(64) } : kind === "missing-graph-sha" ? { ...f.receipt, sourceSha256: undefined } : f.receipt;
      await expect(science.adoptValidated(f.importedViewer, receipt)).rejects.toThrow(kind === "receipt" || kind === "missing-graph-sha" ? "matching validated" : "changed");
      expect(sameEntries(f.imported, entries)).toBe(true);
      expect(science.present(f.imported)).toBe(false);
    } finally { f.close(); }
  }
});

test("receipt-matched manifest does not authorize a payload replaced before adoption", async () => {
  const f = await importedFixture();
  try {
    const asset = fileAsset(f.assets[1].id, "foreign-source.sdf");
    const bytes = f.assets[1].bytes.slice(); bytes[0] ^= 1;
    f.imported.managers.asset.set(asset, new File([bytes], asset.name), { tag: "foreign-owner", isStatic: true });
    const entries = f.imported.managers.asset.assets;
    await expect(science.adoptValidated(f.importedViewer, f.receipt)).rejects.toThrow("attachments changed");
    expect(sameEntries(f.imported, entries)).toBe(true);
    expect(f.imported.managers.asset.get(asset)!.tag).toBe("foreign-owner");
    expect(science.present(f.imported)).toBe(false);
  } finally { f.close(); }
});

test("adoption refuses inventory, file or descriptor changes across the actual digest await", async () => {
  for (const kind of ["replace", "file", "descriptor", "added"] as const) {
    const f = await importedFixture(), held = { entered: deferred(), release: deferred() };
    try {
      nextDigest = held;
      const running = science.adoptValidated(f.importedViewer, f.receipt); await held.entered.promise;
      const asset = fileAsset(f.assets[2].id, "foreign-original.bin"), file = new File([f.assets[2].bytes], asset.name);
      const entry = f.imported.managers.asset.get(asset)!;
      if (kind === "replace") f.imported.managers.asset.set(asset, file, { tag: "foreign-owner" });
      if (kind === "file") entry.file = file;
      if (kind === "descriptor") entry.asset = asset;
      if (kind === "added") f.imported.managers.asset.set(fileAsset("burette-science-other", "added"), file);
      const entries = f.imported.managers.asset.assets;
      held.release.resolve(); await expect(running).rejects.toThrow("attachments");
      expect(sameEntries(f.imported, entries)).toBe(true);
      expect(science.present(f.imported)).toBe(false);
    } finally { nextDigest = null; held.release.resolve(); f.close(); }
  }
});

test("adoption rechecks displayed SDF after held digest and serializes ownership transfers", async () => {
  const f = await importedFixture(), held = { entered: deferred(), release: deferred() };
  try {
    nextDigest = held;
    const running = science.adoptValidated(f.importedViewer, f.receipt); await held.entered.promise;
    const waiting = science.adoptValidated(f.importedViewer, f.receipt);
    void waiting.catch(() => {});
    await expect(science.serialize(f.importedViewer, f.request, options)).rejects.toThrow("already being saved");
    const entries = f.imported.managers.asset.assets;
    await f.imported.state.data.build().to(f.raw.ref).update({ data: source + "\n" }).commit();
    held.release.resolve(); await expect(running).rejects.toThrow("changed");
    await expect(waiting).rejects.toThrow("changed");
    expect(sameEntries(f.imported, entries)).toBe(true);
    expect(science.present(f.imported)).toBe(false);
  } finally { nextDigest = null; held.release.resolve(); f.close(); }
});

test("same-archive reload rejects the old ACK before capture without touching the new load assets", async () => {
  const f = await importedFixture();
  try {
    const prior = f.imported.managers.asset.assets.filter(entry => entry.asset.id.startsWith(science.prefix));
    const token = science.beginImport(f.imported);
    await expect(science.adoptValidated(f.importedViewer, f.receipt)).rejects.toThrow("import changed");
    await f.imported.managers.snapshot.open(new File([f.archive], "same-again.molx"));
    expect(science.completeImport(f.imported, token)).toBe(true);
    expect(prior.every(entry => f.imported.managers.asset.get(entry.asset) !== entry)).toBe(true);
    const entries = f.imported.managers.asset.assets;
    const report = await science.sdfBinding(f.importedViewer);
    expect(report.importToken === f.receipt.importToken).toBe(false);
    await expect(science.adoptValidated(f.importedViewer, f.receipt)).rejects.toThrow("import changed");
    expect(sameEntries(f.imported, entries)).toBe(true);
    const receipt = { ...f.receipt, importToken: report.importToken };
    expect(await science.adoptValidated(f.importedViewer, receipt)).toBe(true);
    expect(await science.adoptValidated(f.importedViewer, receipt)).toBe(true);
    expect(f.imported.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
  } finally { f.close(); }
});


test("same-archive reload during an ACK digest preserves the new load and rejects the old transfer", async () => {
  const f = await importedFixture(), held = { entered: deferred(), release: deferred() };
  try {
    nextDigest = held;
    const running = science.adoptValidated(f.importedViewer, f.receipt); await held.entered.promise;
    const token = science.beginImport(f.imported);
    await f.imported.managers.snapshot.open(new File([f.archive], "same-during-ack.molx"));
    science.completeImport(f.imported, token);
    const entries = f.imported.managers.asset.assets;
    held.release.resolve(); await expect(running).rejects.toThrow("changed");
    expect(sameEntries(f.imported, entries)).toBe(true);
    expect(science.present(f.imported)).toBe(false);
    expect(await science.adoptValidated(f.importedViewer, { ...f.receipt, importToken: token })).toBe(true);
  } finally { nextDigest = null; held.release.resolve(); f.close(); }
});

test("actual viewer MOLX load retains assets and routes only the validated host ACK to adoption", async () => {
  const f = await fixture(), plugin = new PluginContext(DefaultPluginSpec());
  try {
    const archive = await science.serialize(f.viewer, f.request, options); await plugin.init();
    const text = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
    const start = text.indexOf("if (prepared.format === 'molx') {", text.indexOf("async function loadPreparedStructure"));
    const load = text.slice(start, text.indexOf("} else {", start)) + "}";
    const viewer = { plugin }, unavailable = () => { throw new Error("Unexpected script load"); };
    let loadingGuarded = false;
    const open = plugin.managers.snapshot.open.bind(plugin.managers.snapshot);
    plugin.managers.snapshot.open = async file => {
      try { science.binding(viewer); } catch (error) { loadingGuarded = (error as Error).message.includes("finish opening"); }
      return open(file);
    };
    await new Function("window", "viewer", "prepared", "runtimeURL", "loadScript", `return (async () => { let snapshot; ${load}; return snapshot; })();`)
      (window, viewer, { format: "molx", data: archive }, unavailable, unavailable);
    expect(loadingGuarded).toBe(true);
    const report = await science.sdfBinding(viewer);
    expect(typeof report.importToken).toBe("string");
    expect(plugin.managers.asset.assets.filter(entry => entry.asset.id.startsWith(science.prefix)).length).toBe(3);
    expect(science.present(plugin)).toBe(false);
    const route = text.match(/    if \(type === 'scene_science_restore_ack'\) \{[\s\S]*?\n    \}/u)![0];
    const response = await new Function("window", "action", "activeMolstarViewer", "runtimeURL", "loadScript", `return (async () => { const type = action.type; ${route} })();`)
      (window, { type: "scene_science_restore_ack", ...f.request, importToken: report.importToken, manifestSha256: await hash(f.assets[0].bytes) }, () => viewer, unavailable, unavailable);
    expect(response).toEqual({ ok: true, result: { adopted: true } });
    expect(plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
  } finally { plugin.dispose(); f.close(); }
});


test("idempotent ACK still requires the validated graph source hash", async () => {
  const f = await importedFixture();
  try {
    expect(await science.adoptValidated(f.importedViewer, f.receipt)).toBe(true);
    await expect(science.adoptValidated(f.importedViewer, { ...f.receipt, sourceSha256: undefined })).rejects.toThrow("matching validated graph");
    await f.imported.state.data.build().to(f.raw.ref).update({ data: source + "\n" }).commit();
    await expect(science.adoptValidated(f.importedViewer, f.receipt)).rejects.toThrow("changed");
    expect(f.imported.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
  } finally { f.close(); }
});


test("a new load ACK waits for a cancelled old transfer instead of failing busy", async () => {
  const f = await importedFixture(), held = { entered: deferred(), release: deferred() };
  try {
    nextDigest = held;
    const old = science.adoptValidated(f.importedViewer, f.receipt); void old.catch(() => {}); await held.entered.promise;
    const token = science.beginImport(f.imported);
    await f.imported.managers.snapshot.open(new File([f.archive], "overlapping-same.molx"));
    science.completeImport(f.imported, token);
    await expect(science.adoptValidated(f.importedViewer, f.receipt)).rejects.toThrow("import changed");
    let settled = false;
    const current = science.adoptValidated(f.importedViewer, { ...f.receipt, importToken: token });
    current.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    held.release.resolve(); await expect(old).rejects.toThrow("changed");
    expect(await current).toBe(true);
    expect(f.imported.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
  } finally { nextDigest = null; held.release.resolve(); f.close(); }
});

test("actual host viewer actions bind scientific sources and serialize their full scene assets", async () => {
  const f = await fixture();
  f.plugin.state.setSnapshotParams({ camera: false });
  try {
    const text = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
    const start = text.indexOf("async function executeBuretteAgentAction(");
    const routes = text.slice(start, text.indexOf("    if (type === 'measurement_preview_capture')", start)) + "}";
    const unavailable = () => { throw new Error("Unexpected script load"); };
    const execute = new Function("window", "activeMolstarViewer", "activeConfig", "document", "bytesToBase64", "runtimeURL", "loadScript", `${routes}; return executeBuretteAgentAction;`)
      (window, () => f.viewer, {}, dom.document, (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"), unavailable, unavailable);
    const report = await execute({ type: "scene_science_binding", sourceExtension: "sdf" });
    expect(report).toEqual({ ok: true, result: f.report });
    const captured = await execute({ type: "workspace_scene_snapshot", science: f.request });
    const files = unzipSync(new Uint8Array(Buffer.from(captured.result.dataBase64, "base64")));
    for (const asset of f.assets) expect(files[`assets/${asset.id}`]).toEqual(asset.bytes);
    expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
  } finally { f.close(); }
});
