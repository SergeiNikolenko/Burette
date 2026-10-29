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
vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/scene-file-actions.js", import.meta.url), "utf8"), { window, crypto, TextEncoder, TextDecoder, File, Uint8Array, Float64Array });
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



vm.runInNewContext(readFileSync(new URL("../PreviewExtension/Web/burette-agent.js", import.meta.url), "utf8"), { window, performance, Blob, Uint8Array, btoa, atob, setTimeout, clearTimeout });
const viewerText = readFileSync(new URL("../PreviewExtension/Web/viewer.js", import.meta.url), "utf8");
function attach(viewer: { plugin: PluginContext }) {
  window.BuretteAgent.notifyStructureLoaded({ viewer, plugin: viewer.plugin, config: { documentId: "science-export" }, prepared: { format: "sdf" } });
}
async function publicExport(type: "export_session" | "raw_burette_agent") {
  const block = viewerText.match(new RegExp(`    if \\(type === '${type}'\\) \\{[\\s\\S]*?\\n    \\}`, "u"))![0];
  return new Function("window", "action", `return (async () => { const type = action.type; ${block} })();`)
    (window, { type, command: "exportSession", args: { type: "molx", params: { camera: false, image: false } } });
}
function filesOf(result: any) { return unzipSync(new Uint8Array(Buffer.from(result.result.dataBase64, "base64"))); }
const scienceCount = (files: Record<string, Uint8Array>) => Object.keys(files).filter(path => path.startsWith("assets/burette-science-")).length;
const warns = (result: any) => Boolean(result.warnings?.some((warning: string) => warning.includes("Scientific workbench data")));
const summary = (result: any) => [result.ok, scienceCount(filesOf(result)), warns(result)];
const aliases = ["export_session", "raw_burette_agent"] as const;
async function openedFixture() {
  const f = await fixture(), plugin = new PluginContext(DefaultPluginSpec());
  const archive = await science.serialize(f.viewer, f.request, options); await plugin.init();
  const token = science.beginImport(plugin);
  await plugin.managers.snapshot.open(new File([archive], "owned.molx")); science.completeImport(plugin, token);
  return { ...f, plugin, viewer: { plugin }, receipt: { ...f.request, importToken: token, manifestSha256: await hash(f.assets[0].bytes) }, close() { plugin.dispose(); f.close(); } };
}

test("public exports disclose omitted science after validated ownership on both existing aliases", async () => {
  const f = await openedFixture();
  try {
    expect(await science.adoptValidated(f.viewer, f.receipt)).toBe(true); attach(f.viewer);
    const before = f.plugin.managers.asset.get(f.provenance);
    for (const type of aliases) {
      const result = await publicExport(type); expect(summary(result)).toEqual([true, 0, true]);
      expect(filesOf(result)[`assets/${f.provenance.id}`]).toEqual(Uint8Array.of(9, 8, 255, 0));
    }
    expect(f.plugin.managers.asset.get(f.provenance)).toBe(before);
    expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
  } finally { f.close(); }
});

test("plain foreign scene exports keep ordinary assets and carry no scientific omission warning", async () => {
  const f = await fixture();
  try {
    attach(f.viewer);
    for (const type of aliases) {
      const result = await publicExport(type); expect(summary(result)).toEqual([true, 0, false]);
      expect(filesOf(result)[`assets/${f.provenance.id}`]).toEqual(Uint8Array.of(9, 8, 255, 0));
    }
  } finally { f.close(); }
});

test("public exports wait for a successful scientific save and disclose ownership acquired while waiting", async () => {
  const f = await fixture(), held = holdSnapshot(f.plugin);
  try {
    const saving = science.serialize(f.viewer, f.request, options); await held.entered; attach(f.viewer);
    expect(science.present(f.plugin)).toBe(false);
    let completed = 0; const exporting = aliases.map(type => publicExport(type).then(result => { completed++; return result; }));
    await Promise.resolve(); await Promise.resolve(); expect(completed).toBe(0);
    held.release(); await saving;
    expect((await Promise.all(exporting)).map(summary)).toEqual([[true, 0, true], [true, 0, true]]);
    expect(science.present(f.plugin)).toBe(true);
    expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
  } finally { held.release(); f.close(); }
});

test("a failed scientific save cannot leak its temporary attachments into either public export", async () => {
  const f = await fixture(), opened = new PluginContext(DefaultPluginSpec()), held = holdSnapshot(f.plugin);
  try {
    const saving = science.serialize(f.viewer, f.request, options); void saving.catch(() => {}); await held.entered;
    await f.plugin.state.data.build().to(f.raw).update({ data: source + "\n" }).commit(); attach(f.viewer);
    let completed = 0; const exporting = aliases.map(type => publicExport(type).then(result => { completed++; return result; }));
    await Promise.resolve(); await Promise.resolve(); expect(completed).toBe(0);
    held.release(); await expect(saving).rejects.toThrow("changed");
    const results = await Promise.all(exporting);
    expect(results.map(summary)).toEqual([[true, 0, false], [true, 0, false]]);
    await opened.init(); const token = science.beginImport(opened);
    await opened.managers.snapshot.open(new File([new Uint8Array(Buffer.from(results[0].result.dataBase64, "base64"))], "plain-current.molx")); science.completeImport(opened, token);
    expect((await science.sdfBinding({ plugin: opened })).sourceSha256).toBe(await hash(utf8(source + "\n")));
    expect(f.plugin.managers.asset.assets.map(entry => String(entry.asset.id))).toEqual([f.provenance.id]);
  } finally { held.release(); opened.dispose(); f.close(); }
});

test("unacknowledged scientific imports remain untouched and refuse public serialization", async () => {
  const f = await openedFixture();
  try {
    attach(f.viewer); const entries = f.plugin.managers.asset.assets;
    for (const type of aliases) {
      const result = await publicExport(type);
      expect([result.ok, result.error?.code, result.result]).toEqual([false, "BUSY", undefined]);
    }
    expect(entries.every(entry => f.plugin.managers.asset.get(entry.asset) === entry)).toBe(true);
  } finally { f.close(); }
});


test("public export refuses importLoading before imported assets exist", async () => {
  const f = await fixture(), incoming = await fixture("xyz");
  const archive = await science.serialize(incoming.viewer,incoming.request,options);
  const readEntered = deferred(), readRelease = deferred();
  const file = new File([archive],"incoming.molx"), read = file.arrayBuffer.bind(file);
  Object.defineProperty(file,"arrayBuffer",{value:async()=>{readEntered.resolve();await readRelease.promise;return read();}});
  attach(f.viewer);
  const token = science.beginImport(f.plugin);
  const importing = f.plugin.managers.snapshot.open(file).then(()=>science.completeImport(f.plugin,token));
  try {
    await readEntered.promise;
    expect(f.plugin.managers.asset.assets.filter(({asset})=>String(asset.id).startsWith(science.prefix))).toHaveLength(0);
    expect(()=>science.binding(f.viewer)).toThrow("finish opening");
    const result = await publicExport("export_session");
    expect([result.ok,result.error?.code]).toEqual([false,"BUSY"]);
  } finally {readRelease.resolve();await importing; incoming.close();f.close();}
});

test("an import cannot inject its unvalidated attachments into an already-running public export", async () => {
  const f = await fixture(), incoming = await fixture("xyz");
  const archive = await science.serialize(incoming.viewer,incoming.request,options);
  const stateEntered = deferred(), stateRelease = deferred();
  const manager = f.plugin.managers.snapshot, getState = manager.getStateSnapshot.bind(manager);
  manager.getStateSnapshot = (async args=>{const state=await getState(args);stateEntered.resolve();await stateRelease.promise;return state;}) as typeof manager.getStateSnapshot;
  attach(f.viewer);
  const exporting = publicExport("raw_burette_agent");
  try {
    await stateEntered.promise;
    const before = science.binding(f.viewer);
    expect(() => science.beginImport(f.plugin)).toThrow("already being saved");
    expect(science.binding(f.viewer)).toEqual(before);
    expect(f.plugin.managers.asset.assets.filter(({asset})=>String(asset.id).startsWith(science.prefix))).toHaveLength(0);
    stateRelease.resolve(); const result = await exporting;
    expect([result.ok,scienceCount(filesOf(result)),warns(result)]).toEqual([true,0,false]);
    const token = science.beginImport(f.plugin);
    await manager.open(new File([archive],"incoming-after-export.molx"));
    expect(science.completeImport(f.plugin,token)).toBe(true);
    expect(await science.adoptValidated(f.viewer,{...incoming.request,importToken:token,manifestSha256:await hash(incoming.assets[0].bytes)})).toBe(true);
    expect(science.present(f.plugin)).toBe(true);
  } finally {stateRelease.resolve();await exporting;incoming.close();f.close();}
});
